import { useState } from "react";
import { ArrowRight, Check, LogOut, ShieldCheck } from "lucide-react";
import { useAuth } from "../auth/context";
import { errorMessage } from "../lib/api";
import { errorAlertClass, eyebrowClass, inputClass, labelClass, primaryButtonClass } from "../styles";

type Field = "current" | "next" | "confirm";

// Mirrors the backend rules for live feedback; the backend still enforces them.
function passwordChecks(next: string, confirm: string) {
  return [
    { label: "At least 8 characters", met: next.length >= 8 },
    { label: "Contains a letter and a number", met: /\p{L}/u.test(next) && /\d/.test(next) },
    { label: "Matches confirmation", met: next.length > 0 && next === confirm },
  ];
}

function ChangePasswordPage() {
  const { user, changePassword, logout } = useAuth();
  const [values, setValues] = useState<Record<Field, string>>({ current: "", next: "", confirm: "" });
  const [showPasswords, setShowPasswords] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const checks = passwordChecks(values.next, values.confirm);
  const update = (field: Field) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [field]: e.target.value }));

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setError(null);
    setSubmitting(true);
    try {
      await changePassword(values.current, values.next, values.confirm);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  const fields: { id: Field; label: string; placeholder: string; autoComplete: string }[] = [
    { id: "current", label: "Current password", placeholder: "Enter your current password", autoComplete: "current-password" },
    { id: "next", label: "New password", placeholder: "Create a new password", autoComplete: "new-password" },
    { id: "confirm", label: "Confirm new password", placeholder: "Re-enter the new password", autoComplete: "new-password" },
  ];

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f9fc] px-[25px] py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-[30px] grid h-[47px] w-[47px] place-items-center rounded-[14px] bg-[#e7efff] text-[#2563eb]">
          <ShieldCheck size={24} />
        </div>

        <div className="mb-7">
          <p className={`mb-3 ${eyebrowClass}`}>SECURE YOUR ACCOUNT</p>
          <h2 className="mt-0 mb-[10px] text-[32px] tracking-[-1.3px]">Change your password.</h2>
          <p className="m-0 text-[13px] leading-[1.7] text-[#788397]">
            Signed in as <strong className="text-[#344054]">{user?.username}</strong>. Replace the initial
            password before continuing to VocaTechX.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-2.5" noValidate>
          {fields.map((field, index) => (
            <div key={field.id} className="flex flex-col gap-2.5">
              <label htmlFor={field.id} className={labelClass}>
                {field.label}
              </label>
              <input
                id={field.id}
                type={showPasswords ? "text" : "password"}
                placeholder={field.placeholder}
                value={values[field.id]}
                onChange={update(field.id)}
                autoComplete={field.autoComplete}
                autoFocus={index === 0}
                required
                className={inputClass}
              />
            </div>
          ))}

          <div className="mt-1 flex items-start justify-between gap-4">
            <ul className="m-0 grid list-none gap-1.5 p-0">
              {checks.map((check) => (
                <li
                  key={check.label}
                  className={`flex items-center gap-2 text-[11px] ${check.met ? "text-[#15803d]" : "text-[#8b95a6]"}`}
                >
                  <span
                    className={`grid h-3.5 w-3.5 place-items-center rounded-full ${check.met ? "bg-[#dcfce7]" : "bg-[#eef1f5]"}`}
                  >
                    {check.met && <Check size={10} strokeWidth={3} />}
                  </span>
                  {check.label}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="cursor-pointer border-none bg-transparent text-[11px] font-semibold whitespace-nowrap text-[#2563eb]"
              onClick={() => setShowPasswords(!showPasswords)}
            >
              {showPasswords ? "Hide passwords" : "Show passwords"}
            </button>
          </div>

          {error && (
            <p role="alert" className={errorAlertClass}>
              {error}
            </p>
          )}

          <button type="submit" disabled={submitting} className={primaryButtonClass}>
            {submitting ? "Updating…" : "Update password"} <ArrowRight size={17} />
          </button>
        </form>

        <button
          type="button"
          onClick={() => logout()}
          className="mx-auto mt-6 flex cursor-pointer items-center gap-2 border-none bg-transparent text-xs font-semibold text-[#788397] hover:text-[#344054]"
        >
          <LogOut size={14} /> Sign out
        </button>
      </div>
    </main>
  );
}

export default ChangePasswordPage;
