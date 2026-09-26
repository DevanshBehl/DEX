# celestial-landing — Website & Wallet Onboarding

The public Celestial website (`/`) and the wallet onboarding wizard (`/onboarding`). The wizard generates a BIP-39 seed, encrypts it with PBKDF2-SHA256 (600k) + AES-256-GCM, and hands **only the encrypted vault** to the installed Celestial Wallet extension.

Full documentation: [`docs/landing.md`](../docs/landing.md) · Extension side: [`docs/wallet.md`](../docs/wallet.md)

## Quick start

```bash
npm install
npm run dev        # Vite dev server
npm run build      # tsc -b && vite build → dist/
npm run lint
```

No environment variables are needed. To test the vault handoff, load the extension unpacked in the same Chrome profile and open `/onboarding`.

## Layout

```
src/pages/LandingPage.tsx       marketing page
src/pages/OnboardingPage.tsx    welcome → password → seed phrase → completion; VAULT_INIT handshake
src/lib/crypto.ts               PBKDF2 + AES-GCM vault blob
src/lib/validation.ts           zod password policy
src/components/                 SeedPhraseGrid · PasswordStrength
```
