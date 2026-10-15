import { useState } from "react";
import { ArrowRight, Activity, BookOpen, Bot } from "lucide-react";
import vocatechxLogo from "../assets/vocatechx-app-icon.png";
import { useAuth } from "../auth/context";
import { errorMessage } from "../lib/api";
import { dotClass, errorAlertClass, eyebrowClass, inputClass, primaryButtonClass } from "../styles";

function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setError(null);
    setSubmitting(true);
    try {
      await login(username, password);
    } catch (e) {
      setError(errorMessage(e));
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#101827]">
      <div className="grid h-auto max-h-none w-full max-w-[1800px] grid-cols-1 md:h-screen md:max-h-[980px] md:grid-cols-2 lg:overflow-hidden lg:rounded-3xl lg:shadow-[0_30px_90px_rgba(0,0,0,0.25)]">
        <section className="relative flex min-w-0 flex-col justify-between overflow-hidden bg-[#101827] p-[25px] text-white md:px-[clamp(28px,5vw,76px)] md:pt-9 md:pb-6 before:pointer-events-none before:absolute before:top-[22%] before:-right-[200px] before:h-[390px] before:w-[390px] before:rounded-full before:border before:border-[#263956] before:opacity-[0.55] before:content-[''] before:[box-shadow:0_0_0_45px_#101827,0_0_0_46px_#263956,0_0_0_95px_#101827,0_0_0_96px_#263956]">
          <div className="relative flex items-center gap-[11px] text-xl font-extrabold tracking-[1px]">

            <span>VocaTechX</span>
            <span className="border-l border-[#344155] pl-3 text-[10px] font-semibold tracking-[1.2px] text-[#94a3b8]">
              CSS TOOLKIT
            </span>
          </div>

          <div className="relative min-w-0 max-w-[540px] py-[45px] md:py-[54px]">
            <div className={`flex items-center gap-[9px] ${eyebrowClass}`}>
              <span className={`${dotClass} bg-[#3b82f6]`} />
              YOUR COMPUTER SERVICING ASSISTANT
            </div>

            <h1 className="mt-[25px] mb-5 text-[42px] leading-[1.12] tracking-[-2.6px] md:text-[clamp(36px,4.3vw,60px)]">
              Fix smarter.
              <br />
              <span className="text-[#60a5fa]">Learn faster.</span>
            </h1>

            <p className="max-w-[440px] text-sm leading-[1.9] text-[#aab7ca]">
              Your all-in-one toolkit for computer servicing,
              system diagnostics, and intelligent troubleshooting.
              Everything you need to solve technical problems
              in one place.
            </p>

            <div className="mt-10 grid gap-6">
              <div className="flex items-start gap-4">
                <div className="grid h-[43px] w-[43px] flex-shrink-0 place-items-center rounded-xl border border-[#34445c] bg-[#1b2a40] text-[#7db5ff]">
                  <Bot size={22} />
                </div>
                <div>
                  <h3 className="mt-0.5 mb-1.5 text-sm font-semibold">AI Troubleshooter</h3>
                  <p className="m-0 text-xs leading-[1.7] text-[#9baac0]">
                    Get guided solutions to common PC problems.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="grid h-[43px] w-[43px] flex-shrink-0 place-items-center rounded-xl border border-[#34445c] bg-[#1b2a40] text-[#7db5ff]">
                  <Activity size={22} />
                </div>
                <div>
                  <h3 className="mt-0.5 mb-1.5 text-sm font-semibold">System Diagnostics</h3>
                  <p className="m-0 text-xs leading-[1.7] text-[#9baac0]">
                    Inspect networks, devices, and Windows.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="grid h-[43px] w-[43px] flex-shrink-0 place-items-center rounded-xl border border-[#34445c] bg-[#1b2a40] text-[#7db5ff]">
                  <BookOpen size={22} />
                </div>
                <div>
                  <h3 className="mt-0.5 mb-1.5 text-sm font-semibold">CSS Learning Library</h3>
                  <p className="m-0 text-xs leading-[1.7] text-[#9baac0]">
                    Access practical computer servicing references.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <footer className="flex justify-between gap-3 border-t border-[#29364a] pt-[19px] text-[9px] font-semibold tracking-[1px] text-[#8290a6]">
            <span>INSTALL. DIAGNOSE. REPAIR. LEARN.</span>
            <span className="hidden md:inline">DESIGNED FOR TECHNICIANS</span>
          </footer>
        </section>

        <section className="flex min-w-0 flex-col items-center justify-center bg-[#f7f9fc] px-[25px] pt-[45px] pb-[45px] md:px-[clamp(24px,5vw,76px)] md:pt-[35px] md:pb-6">
          <div className="w-full max-w-[390px]">
            <div className="mb-[30px] grid h-[47px] w-[47px] place-items-center rounded-[14px] bg-[#e7efff]">
              <img src={vocatechxLogo} alt="VocaTechX" className="h-7 w-7 object-contain" />
            </div>

            <div className="mb-8">
              <p className={`mb-3 ${eyebrowClass}`}>WELCOME TO VOCATECHX</p>
              <h2 className="mt-0 mb-[10px] text-[32px] tracking-[-1.3px]">Welcome back.</h2>
              <p className="m-0 text-[13px] text-[#788397]">Sign in to access your workspace.</p>
            </div>

            <form onSubmit={handleLogin} className="flex flex-col gap-2.5" noValidate>
              <label htmlFor="username" className="mt-[9px] text-xs font-semibold text-[#344054]">
                Username
              </label>
              <input
                id="username"
                type="text"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                required
                className={inputClass}
              />

              <div className="flex justify-between">
                <label htmlFor="password" className="mt-[9px] text-xs font-semibold text-[#344054]">
                  Password
                </label>
              </div>

              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  className={`${inputClass} pr-[58px]`}
                />
                <button
                  type="button"
                  className="absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer border-none bg-transparent text-[11px] font-semibold text-[#2563eb]"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>

              {error && (
                <p role="alert" className={errorAlertClass}>
                  {error}
                </p>
              )}

              <button type="submit" disabled={submitting} className={primaryButtonClass}>
                {submitting ? "Signing in…" : "Sign in"} <ArrowRight size={17} />
              </button>
            </form>

            <div className="my-[29px] flex items-center gap-3">
              <span className="h-px flex-1 bg-[#e0e5ed]" />
              <p className="text-[9px] font-semibold tracking-[1px] whitespace-nowrap text-[#8b95a6]">
                YOUR WORKSPACE, READY
              </p>
              <span className="h-px flex-1 bg-[#e0e5ed]" />
            </div>

            {/* <div className="flex items-start gap-3 rounded-[10px] border border-[#dce8ff] bg-[#edf3ff] p-[15px]">
              <span className={`${dotClass} mt-[5px] bg-[#16a34a]`} />
              <p className="m-0 text-[11px] leading-[1.8] text-[#64748b]">
                <strong className="text-[#263b5b]">Built for offline work</strong>
                <br />
                Your tools and local AI are designed to work
                without an internet connection.
              </p>
            </div> */}
          </div>

          <p className="mt-[38px] text-center text-[9px] tracking-[1px] text-[#9aa3b2]">
            VOCATECHX · COMPUTER SYSTEMS SERVICING
          </p>
        </section>
      </div>
    </main>
  );
}

export default LoginPage;
