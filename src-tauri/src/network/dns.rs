//! DNS lookups: through the Windows resolver (what apps actually use), and
//! directly against a chosen DNS server with a minimal UDP query so answers
//! from different servers can be compared.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs, UdpSocket};
use std::sync::mpsc;
use std::time::{Duration, Instant};

const TYPE_A: u16 = 1;
const TYPE_CNAME: u16 = 5;
const TYPE_AAAA: u16 = 28;

#[derive(Debug, Clone)]
pub struct Lookup {
  pub addresses: Vec<IpAddr>,
  pub aliases: Vec<String>,
  pub elapsed_ms: u32,
}

/// Resolves `host` through Windows, the same way browsers and other apps do.
pub fn resolve_system(host: &str, timeout: Duration) -> Result<Lookup, String> {
  let (tx, rx) = mpsc::channel();
  let target = format!("{host}:0");
  let started = Instant::now();
  // The system resolver has no timeout parameter, so wait on a thread.
  std::thread::spawn(move || {
    let result = target.to_socket_addrs().map(|addrs| addrs.map(|a| a.ip()).collect::<Vec<_>>());
    let _ = tx.send(result);
  });
  match rx.recv_timeout(timeout) {
    Ok(Ok(mut addresses)) => {
      addresses.dedup();
      addresses.sort_by_key(IpAddr::is_ipv6);
      if addresses.is_empty() {
        return Err("The name resolved to no addresses.".into());
      }
      Ok(Lookup { addresses, aliases: Vec::new(), elapsed_ms: elapsed_ms(started) })
    }
    Ok(Err(e)) => Err(describe_resolver_error(&e)),
    Err(_) => Err(format!("No answer within {} seconds. The DNS server may be unreachable.", timeout.as_secs())),
  }
}

fn describe_resolver_error(e: &std::io::Error) -> String {
  match e.raw_os_error() {
    Some(11001) => "The name does not exist or no DNS server could find it.".into(),
    Some(11002) => "The DNS server did not respond (temporary failure).".into(),
    Some(11003) => "The DNS server refused or failed the request.".into(),
    Some(11004) => "The name exists but has no address record.".into(),
    _ => format!("Name resolution failed: {e}"),
  }
}

fn elapsed_ms(started: Instant) -> u32 {
  started.elapsed().as_millis().min(u32::MAX as u128) as u32
}

/// Sends an A-record query for `domain` straight to `server`.
pub fn query_server(server: IpAddr, domain: &str, timeout: Duration) -> Result<Lookup, String> {
  let id = (now_nanos() ^ std::process::id()) as u16;
  let query = build_query(id, domain, TYPE_A);
  let bind: SocketAddr = match server {
    IpAddr::V4(_) => (Ipv4Addr::UNSPECIFIED, 0).into(),
    IpAddr::V6(_) => (Ipv6Addr::UNSPECIFIED, 0).into(),
  };
  let socket = UdpSocket::bind(bind).map_err(|e| format!("Could not open a network socket: {e}"))?;
  socket.set_read_timeout(Some(timeout)).ok();
  socket.connect((server, 53)).map_err(|e| format!("Could not reach {server}: {e}"))?;

  let started = Instant::now();
  socket.send(&query).map_err(|e| format!("Could not send the query to {server}: {e}"))?;
  let mut buffer = [0u8; 1500];
  loop {
    let len = match socket.recv(&mut buffer) {
      Ok(len) => len,
      Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {
        return Err(format!("{server} did not answer within {} seconds.", timeout.as_secs()));
      }
      Err(e) => return Err(format!("{server} could not be reached: {e}")),
    };
    match parse_response(id, &buffer[..len]) {
      // A stray packet with another ID: keep waiting for ours.
      Err(ParseError::WrongId) => continue,
      Err(ParseError::Malformed) => return Err(format!("{server} sent an unreadable answer.")),
      Ok(answer) => {
        let elapsed_ms = elapsed_ms(started);
        return match answer.rcode {
          0 if answer.addresses.is_empty() => Err("The server answered but returned no IPv4 address.".into()),
          0 => Ok(Lookup { addresses: answer.addresses, aliases: answer.aliases, elapsed_ms }),
          2 => Err(format!("{server} reported a server failure (SERVFAIL).")),
          3 => Err(format!("{server} says this domain does not exist (NXDOMAIN).")),
          5 => Err(format!("{server} refused the query (REFUSED).")),
          code => Err(format!("{server} returned error code {code}.")),
        };
      }
    }
  }
}

fn now_nanos() -> u32 {
  std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0)
}

pub fn build_query(id: u16, domain: &str, qtype: u16) -> Vec<u8> {
  let mut packet = Vec::with_capacity(32 + domain.len());
  packet.extend_from_slice(&id.to_be_bytes());
  packet.extend_from_slice(&0x0100u16.to_be_bytes()); // standard query, recursion desired
  packet.extend_from_slice(&1u16.to_be_bytes()); // one question
  packet.extend_from_slice(&[0, 0, 0, 0, 0, 0]);
  for label in domain.trim_end_matches('.').split('.') {
    packet.push(label.len() as u8);
    packet.extend_from_slice(label.as_bytes());
  }
  packet.push(0);
  packet.extend_from_slice(&qtype.to_be_bytes());
  packet.extend_from_slice(&1u16.to_be_bytes()); // class IN
  packet
}

#[derive(Debug, PartialEq)]
pub enum ParseError {
  WrongId,
  Malformed,
}

#[derive(Debug, PartialEq)]
pub struct Answer {
  pub rcode: u8,
  pub addresses: Vec<IpAddr>,
  pub aliases: Vec<String>,
}

pub fn parse_response(id: u16, packet: &[u8]) -> Result<Answer, ParseError> {
  let u16_at = |at: usize| packet.get(at..at + 2).map(|b| u16::from_be_bytes([b[0], b[1]])).ok_or(ParseError::Malformed);
  if u16_at(0)? != id {
    return Err(ParseError::WrongId);
  }
  let flags = u16_at(2)?;
  if flags & 0x8000 == 0 {
    return Err(ParseError::Malformed);
  }
  let questions = u16_at(4)?;
  let answers = u16_at(6)?;

  let mut at = 12;
  for _ in 0..questions {
    at = read_name(packet, at)?.1 + 4;
  }

  let mut addresses = Vec::new();
  let mut aliases = Vec::new();
  for _ in 0..answers {
    let (_, next) = read_name(packet, at)?;
    let rtype = u16_at(next)?;
    let len = u16_at(next + 8)? as usize;
    let data_at = next + 10;
    let data = packet.get(data_at..data_at + len).ok_or(ParseError::Malformed)?;
    match (rtype, len) {
      (TYPE_A, 4) => addresses.push(IpAddr::V4(Ipv4Addr::new(data[0], data[1], data[2], data[3]))),
      (TYPE_AAAA, 16) => {
        let mut octets = [0u8; 16];
        octets.copy_from_slice(data);
        addresses.push(IpAddr::V6(Ipv6Addr::from(octets)));
      }
      (TYPE_CNAME, _) => aliases.push(read_name(packet, data_at)?.0),
      _ => {}
    }
    at = data_at + len;
  }

  Ok(Answer { rcode: (flags & 0x000f) as u8, addresses, aliases })
}

/// Reads a possibly compressed name. Returns the name and the offset just
/// past it in the original position.
fn read_name(packet: &[u8], start: usize) -> Result<(String, usize), ParseError> {
  let mut labels = Vec::new();
  let mut at = start;
  let mut end = None;
  for _ in 0..128 {
    let len = *packet.get(at).ok_or(ParseError::Malformed)? as usize;
    if len == 0 {
      return Ok((labels.join("."), end.unwrap_or(at + 1)));
    }
    if len & 0xc0 == 0xc0 {
      let low = *packet.get(at + 1).ok_or(ParseError::Malformed)? as usize;
      end.get_or_insert(at + 2);
      at = ((len & 0x3f) << 8) | low;
      continue;
    }
    let label = packet.get(at + 1..at + 1 + len).ok_or(ParseError::Malformed)?;
    labels.push(String::from_utf8_lossy(label).into_owned());
    at += 1 + len;
  }
  Err(ParseError::Malformed)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn response(id: u16, rcode: u8) -> Vec<u8> {
    let mut p = build_query(id, "www.example.com", TYPE_A);
    p[2] = 0x81;
    p[3] = 0x80 | rcode;
    p[7] = 2; // two answers
    // CNAME www.example.com -> edge.example.net, using a pointer to the question name
    p.extend_from_slice(&[0xc0, 12, 0, 5, 0, 1, 0, 0, 0, 60]);
    let target = [4, b'e', b'd', b'g', b'e', 7, b'e', b'x', b'a', b'm', b'p', b'l', b'e', 3, b'n', b'e', b't', 0];
    p.extend_from_slice(&(target.len() as u16).to_be_bytes());
    let cname_at = p.len();
    p.extend_from_slice(&target);
    // A record for the alias, again compressed
    p.extend_from_slice(&[0xc0, cname_at as u8, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 93, 184, 216, 34]);
    p
  }

  #[test]
  fn builds_a_standard_query() {
    let q = build_query(0xabcd, "example.com", TYPE_A);
    assert_eq!(&q[..4], &[0xab, 0xcd, 0x01, 0x00]);
    assert_eq!(&q[12..], b"\x07example\x03com\x00\x00\x01\x00\x01");
  }

  #[test]
  fn parses_compressed_answers() {
    let answer = parse_response(7, &response(7, 0)).unwrap();
    assert_eq!(answer.rcode, 0);
    assert_eq!(answer.addresses, vec![IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34))]);
    assert_eq!(answer.aliases, vec!["edge.example.net".to_string()]);
  }

  #[test]
  fn rejects_wrong_ids_and_garbage() {
    assert_eq!(parse_response(8, &response(7, 0)), Err(ParseError::WrongId));
    assert_eq!(parse_response(7, &[0, 7, 0x81]), Err(ParseError::Malformed));
    let mut looping = response(7, 0);
    let at = looping.len() - 16;
    looping[at + 1] = at as u8; // pointer to itself
    assert!(parse_response(7, &looping).is_err());
  }

  #[test]
  fn reports_rcode() {
    assert_eq!(parse_response(9, &response(9, 3)).unwrap().rcode, 3);
  }
}
