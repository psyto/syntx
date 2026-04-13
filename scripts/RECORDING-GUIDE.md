# Demo Video Recording Guide

Record a 2-3 minute product walkthrough with your Phantom wallet on devnet.

## Setup (before recording)

### 1. Switch Phantom to devnet
- Phantom → Settings → Developer Settings → Change Network → Devnet

### 2. Get devnet USDC for vault 1
The vaults use different test USDC mints. You need tokens for the vault you'll deposit into.

```bash
# Mint test USDC for vault 1 (SOL Funding Rate)
cd ~/src/syntx/keeper
npx ts-node -e "
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { mintTo, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import { readFileSync } from 'fs';

async function main() {
  const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.HOME + '/.config/solana/id.json', 'utf-8'))));

  // Vault 1 collateral mint
  const mint = new PublicKey('2uGTCDSfisKCTN2Yd8umXiWJzfRpWe8mhZM6WCK2vj8D');
  // YOUR Phantom devnet address — replace this:
  const yourWallet = new PublicKey('YOUR_PHANTOM_DEVNET_ADDRESS');

  const ata = await getOrCreateAssociatedTokenAccount(conn, admin, mint, yourWallet);
  await mintTo(conn, admin, mint, ata.address, admin, 100_000_000); // 100 USDC
  console.log('Minted 100 test USDC to', ata.address.toBase58());
}
main().catch(console.error);
"
```

### 3. Get devnet SOL for gas
```bash
solana airdrop 2 YOUR_PHANTOM_DEVNET_ADDRESS --url devnet
```

### 4. Open the site
- Go to `https://fabrknt.com/vaults` in Chrome
- Connect Phantom wallet

## Recording (use Loom or OBS)

### Scene 1: Landing (20s)
- Start recording at `fabrknt.com/vaults`
- **Voiceover:** "Syntx is a composable exchange-agnostic vault layer on Solana."
- Slowly scroll down past the hero → stats → feature cards
- Pause on the **venue routing diagram** (Percolator / Phoenix / Jupiter Perps)
- **Voiceover:** "Vaults route trades across three different DEX architectures through a single interface."

### Scene 2: Vault Marketplace (20s)
- Click **"Vaults"** in the nav
- Show the marketplace with 2 named vaults (SOL Funding Rate, SOL Delta Neutral)
- **Voiceover:** "Two live vaults on devnet, each with a venue badge showing which DEX it trades on."
- Click **"SOL Funding Rate"** vault to expand
- Show: share price, equity, position, funding rate

### Scene 3: Deposit (30s)
- In the expanded vault, scroll to **Actions**
- Click **"Max"** button (shows your USDC balance)
- Enter an amount (e.g., 10)
- Click **"Deposit"**
- **Phantom popup** appears — click **Approve**
- Wait for confirmation
- **Toast notification** appears: "Deposited 10 USDC" with **"View tx"** link
- Click the **"View tx"** link → Solana Explorer opens showing the transaction
- **Voiceover:** "Deposit USDC, receive SPL share tokens. Toast with Explorer link."

### Scene 4: Your Position (10s)
- Show the **"Your Position"** section — shares, value, share %
- **Voiceover:** "Your position updates in real time. Share tokens are standard SPL — usable as collateral across DeFi."

### Scene 5: Withdraw (20s)
- Enter a dollar amount in **Withdraw**
- Click **"Withdraw"**
- Phantom approves
- Toast: "Withdrawal successful"
- **Voiceover:** "Withdraw by dollar amount — the SDK auto-converts to shares."

### Scene 6: Compose (20s)
- Click **"Compose"** in the nav
- Show the recipes grid (click one to expand steps)
- Scroll down to **architecture diagram** — Depositors → Syntx Vault → [Percolator | Phoenix | Jupiter Perps]
- **Voiceover:** "Any Solana program can compose via CPI. Three architectures unified behind one interface."
- Scroll to **CPI code snippets** (cpi_trade, get_share_price)
- Show the **VenueAdapter interface** — "add a new DEX in six methods"

### Scene 7: Close (10s)
- Scroll back to top or show landing
- **Voiceover:** "Fifteen instructions. Twenty-nine tests. Four venue adapters. Composable exchange-agnostic vaults on Solana."

## Total: ~2.5 minutes

## Tips
- **Don't rush.** Let each screen breathe for 2-3 seconds before moving on.
- **Use a clean browser.** Close other tabs, hide bookmarks bar.
- **1080p or higher.** Loom defaults to this. OBS: set canvas to 1920x1080.
- **Voiceover:** Record separately if nervous. Screen record first, then add voice in Loom's editor.
- **Multiple takes.** Record 2-3 times. Pick the smoothest one.
- **If deposit fails:** Devnet can be flaky. Have the Puppeteer demo video as backup.

## Upload
- Upload to YouTube (unlisted is fine)
- Paste the URL into the Colosseum submission form under "Product demo video"
