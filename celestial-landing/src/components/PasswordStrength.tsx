import {
  checkPasswordRules,
  getPasswordStrength,
  getStrengthLabel,
  getStrengthColor,
} from '../lib/validation';

interface Props {
  password: string;
}

export default function PasswordStrength({ password }: Props) {
  const rules = checkPasswordRules(password);
  const strength = getPasswordStrength(password);
  const label = getStrengthLabel(strength);
  const color = getStrengthColor(strength);

  if (!password) return null;

  return (
    <div className="flex flex-col gap-3">
      {/* Strength Bar */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium" style={{ color: color }}>
            {label}
          </span>
        </div>
        <div className="flex gap-1.5">
          {[1, 2, 3, 4].map((level) => (
            <div
              key={level}
              className="h-1 flex-1 rounded-full transition-all duration-300"
              style={{
                backgroundColor:
                  strength >= level ? color : 'rgba(255,255,255,0.06)',
              }}
            />
          ))}
        </div>
      </div>

      {/* Rule Checklist */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        <RuleItem label="8+ characters" passed={rules.minLength} />
        <RuleItem label="Uppercase letter" passed={rules.hasUppercase} />
        <RuleItem label="Number" passed={rules.hasNumber} />
        <RuleItem label="Special character" passed={rules.hasSpecial} />
      </div>
    </div>
  );
}

function RuleItem({ label, passed }: { label: string; passed: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span
        className="transition-colors duration-200"
        style={{ color: passed ? '#22c55e' : 'rgba(255,255,255,0.25)' }}
      >
        {passed ? '✓' : '✗'}
      </span>
      <span
        className="transition-colors duration-200"
        style={{
          color: passed
            ? 'rgba(255,255,255,0.7)'
            : 'rgba(255,255,255,0.3)',
        }}
      >
        {label}
      </span>
    </div>
  );
}
