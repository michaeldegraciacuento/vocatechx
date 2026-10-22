//! Reads an installer before it is set up, so the setup dialog can be filled in
//! for the technician: the installer technology (which decides the silent
//! switches), product name and version, and its Authenticode signature.

use std::fs::File;
use std::io::Read;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::library::InstallerType;
use crate::devices::query_one;
use crate::network::process::ps_quote;

/// Installer stubs keep their markers near the start of the file.
const SNIFF_BYTES: u64 = 8 * 1024 * 1024;

/// The OLE compound-file signature every .msi starts with.
const OLE_MAGIC: &[u8] = &[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Signature {
  /// Signed, and Windows trusts the signature.
  Valid,
  NotSigned,
  /// The file was modified after it was signed. It is never set up.
  Tampered,
  /// Signed, but Windows does not trust the signature (expired, untrusted root…).
  Untrusted,
}

/// Everything the setup dialog shows about one installer.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallerDetails {
  pub source: String,
  pub file_name: String,
  pub size_bytes: u64,
  /// The detected technology, or `None` if it is not one VocaTechX recognises.
  pub detected_type: Option<InstallerType>,
  pub product_name: Option<String>,
  pub version: Option<String>,
  pub company: Option<String>,
  pub signature: Signature,
  pub signer: Option<String>,
  /// Suggested name and installed-program name for the form.
  pub suggested_name: String,
  pub suggested_detect: String,
}

/// Recognises the installer technology from its file contents.
pub fn sniff(path: &Path) -> std::io::Result<Option<InstallerType>> {
  let mut bytes = Vec::new();
  File::open(path)?.take(SNIFF_BYTES).read_to_end(&mut bytes)?;
  Ok(sniff_bytes(&bytes))
}

fn sniff_bytes(bytes: &[u8]) -> Option<InstallerType> {
  if bytes.starts_with(OLE_MAGIC) {
    return Some(InstallerType::Msi);
  }
  if !bytes.starts_with(b"MZ") {
    return None;
  }
  let has = |marker: &[u8]| bytes.windows(marker.len()).any(|w| w == marker);
  if has(b"Inno Setup") {
    Some(InstallerType::Inno)
  } else if has(b"NullsoftInst") || has(b"Nullsoft Install System") {
    Some(InstallerType::Nsis)
  } else if has(b".wixburn") {
    Some(InstallerType::Burn)
  } else {
    None
  }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawMetadata {
  #[serde(default)]
  product_name: Option<String>,
  #[serde(default)]
  version: Option<String>,
  #[serde(default)]
  company: Option<String>,
  #[serde(default)]
  signature: Option<String>,
  #[serde(default)]
  signer: Option<String>,
}

const METADATA_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$p = __PATH__
$out = [ordered]@{ productName = $null; version = $null; company = $null; signature = 'UnknownError'; signer = $null }
try {
  $sig = Get-AuthenticodeSignature -LiteralPath $p
  $out.signature = [string]$sig.Status
  if ($sig.SignerCertificate) {
    $out.signer = $sig.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
  }
} catch {}
if ($p.ToLowerInvariant().EndsWith('.msi')) {
  $wi = $null; $db = $null
  try {
    $wi = New-Object -ComObject WindowsInstaller.Installer
    $db = $wi.GetType().InvokeMember('OpenDatabase', 'InvokeMethod', $null, $wi, @($p, 0))
    $props = @{}
    foreach ($name in 'ProductName', 'ProductVersion', 'Manufacturer') {
      $view = $db.GetType().InvokeMember('OpenView', 'InvokeMethod', $null, $db, @("SELECT Value FROM Property WHERE Property='$name'"))
      $view.GetType().InvokeMember('Execute', 'InvokeMethod', $null, $view, $null) | Out-Null
      $rec = $view.GetType().InvokeMember('Fetch', 'InvokeMethod', $null, $view, $null)
      if ($rec) { $props[$name] = $rec.GetType().InvokeMember('StringData', 'GetProperty', $null, $rec, 1) }
      $view.GetType().InvokeMember('Close', 'InvokeMethod', $null, $view, $null) | Out-Null
    }
    $out.productName = $props['ProductName']
    $out.version = $props['ProductVersion']
    $out.company = $props['Manufacturer']
  } catch {
  } finally {
    if ($db) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($db) }
    if ($wi) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($wi) }
  }
} else {
  try {
    $v = (Get-Item -LiteralPath $p).VersionInfo
    $out.productName = $v.ProductName
    # The numeric version is reliable; the text one is free-form (Notepad++
    # 8.9.8 calls itself "8.98"), so it is only a fallback.
    $numeric = '{0}.{1}.{2}.{3}' -f $v.ProductMajorPart, $v.ProductMinorPart, $v.ProductBuildPart, $v.ProductPrivatePart
    $out.version = if ($numeric -ne '0.0.0.0') { $numeric } elseif ($v.ProductVersion) { $v.ProductVersion } else { $v.FileVersion }
    $out.company = $v.CompanyName
  } catch {}
}
[pscustomobject]$out | ConvertTo-Json -Compress
"#;

fn clean(value: Option<String>) -> Option<String> {
  value.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn read_metadata(path: &Path) -> RawMetadata {
  let script = METADATA_SCRIPT.replace("__PATH__", &ps_quote(&path.to_string_lossy()));
  query_one::<RawMetadata>("Could not read the installer", &script).unwrap_or_else(|e| {
    log::warn!("{e}");
    RawMetadata::default()
  })
}

fn signature(status: Option<&str>) -> Signature {
  match status.unwrap_or("") {
    "Valid" => Signature::Valid,
    "NotSigned" => Signature::NotSigned,
    "HashMismatch" => Signature::Tampered,
    _ => Signature::Untrusted,
  }
}

/// `ProductVersion` strings sometimes use commas (`1, 4, 1, 1032`).
fn normalize_version(version: Option<String>) -> Option<String> {
  clean(version).map(|v| v.replace(", ", ".").replace(',', "."))
}

/// A Windows "installed programs" name to look for: the product name without
/// a trailing version number or architecture tag.
fn suggest_detect(name: &str) -> String {
  let words: Vec<&str> = name.split_whitespace().collect();
  let mut end = words.len();
  while end > 1 {
    let w = words[end - 1].trim_matches(|c| c == '(' || c == ')').to_ascii_lowercase();
    let versionish = w.starts_with(|c: char| c.is_ascii_digit()) || w.starts_with('v') && w[1..].starts_with(|c: char| c.is_ascii_digit());
    if versionish || matches!(w.as_str(), "x64" | "x86" | "64-bit" | "32-bit" | "amd64" | "setup" | "installer") {
      end -= 1;
    } else {
      break;
    }
  }
  words[..end].join(" ")
}

/// A readable name from an installer file name, for when it has no metadata.
fn name_from_file(file_name: &str) -> String {
  let stem = Path::new(file_name).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
  let spaced: String = stem.chars().map(|c| if c == '_' || c == '-' || c == '.' { ' ' } else { c }).collect();
  let name = suggest_detect(spaced.trim());
  if name.is_empty() { stem } else { name }
}

/// Inspects one installer for the setup dialog.
pub fn details(source: &str, path: &Path) -> Result<InstallerDetails, String> {
  let file_name = path.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
  let size_bytes = std::fs::metadata(path).map_err(|e| format!("Could not read {file_name}: {e}"))?.len();
  let detected_type = sniff(path).map_err(|e| format!("Could not read {file_name}: {e}"))?;
  let raw = read_metadata(path);

  let product_name = clean(raw.product_name);
  let suggested_name = product_name.as_deref().map(suggest_detect).filter(|n| !n.is_empty()).unwrap_or_else(|| name_from_file(&file_name));
  Ok(InstallerDetails {
    source: source.to_string(),
    file_name,
    size_bytes,
    detected_type,
    suggested_detect: suggested_name.clone(),
    suggested_name,
    product_name,
    version: normalize_version(raw.version),
    company: clean(raw.company),
    signature: signature(raw.signature.as_deref()),
    signer: clean(raw.signer),
  })
}

/// The version and publisher recorded in `app.json` at setup. The publisher is
/// the signer when the file is validly signed, otherwise the company it claims.
pub fn version_and_publisher(path: &Path) -> (Option<String>, Option<String>) {
  let raw = read_metadata(path);
  let publisher = if signature(raw.signature.as_deref()) == Signature::Valid { clean(raw.signer) } else { None };
  (normalize_version(raw.version), publisher.or_else(|| clean(raw.company)))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn sniffs_installer_technology() {
    let mut msi = OLE_MAGIC.to_vec();
    msi.extend_from_slice(b"rest");
    assert_eq!(sniff_bytes(&msi), Some(InstallerType::Msi));
    assert_eq!(sniff_bytes(b"MZ....Inno Setup Setup Data (6.2.0)"), Some(InstallerType::Inno));
    assert_eq!(sniff_bytes(b"MZ....\xEF\xBE\xAD\xDENullsoftInst"), Some(InstallerType::Nsis));
    assert_eq!(sniff_bytes(b"MZ....PE..text.wixburn"), Some(InstallerType::Burn));
    assert_eq!(sniff_bytes(b"MZ....something else"), None);
    assert_eq!(sniff_bytes(b"not an executable"), None);
  }

  #[test]
  fn suggests_names_without_versions() {
    assert_eq!(suggest_detect("VLC media player"), "VLC media player");
    assert_eq!(suggest_detect("7-Zip 26.05 (x64)"), "7-Zip");
    assert_eq!(suggest_detect("Notepad++ v8.9.8 x64"), "Notepad++");
    assert_eq!(name_from_file("npp.8.9.8.1.Installer.x64.msi"), "npp");
    assert_eq!(name_from_file("Firefox Setup 157.0.1.exe"), "Firefox");
    assert_eq!(normalize_version(Some("1, 4, 1, 1032".into())).as_deref(), Some("1.4.1.1032"));
  }

  #[test]
  fn maps_signature_status() {
    assert_eq!(signature(Some("Valid")), Signature::Valid);
    assert_eq!(signature(Some("NotSigned")), Signature::NotSigned);
    assert_eq!(signature(Some("HashMismatch")), Signature::Tampered);
    assert_eq!(signature(Some("NotTrusted")), Signature::Untrusted);
  }

  /// Reads a real signed Windows executable, plus any installers in the
  /// project's application folder.
  /// `cargo test software_inspect_live -- --ignored --nocapture`
  #[test]
  #[ignore]
  fn software_inspect_live() {
    let path = crate::network::process::system32("notepad.exe");
    let notepad = details("notepad.exe", &path).unwrap();
    println!("{notepad:#?}");
    assert!(notepad.product_name.is_some());
    assert!(notepad.version.is_some());

    let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join(super::super::FOLDER_NAME);
    for pending in super::super::library::scan(&folder).pending {
      println!("{:#?}", details(&pending.source, &pending.path).unwrap());
    }
  }
}
