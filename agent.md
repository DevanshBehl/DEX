CELESTIAL AI: COMPREHENSIVE ARCHITECTURE & TECHNICAL SPECIFICATION

Version: 1.0.0
Context: Chrome Extension (Manifest V3)
Core Technologies: React, Next.js, Zustand, Ethers.js v6, Tailwind CSS, OpenAI API (Structured Outputs).

1. EXECUTIVE SUMMARY & CORE PHILOSOPHY

Celestial AI is an "Intent-Based" Web3 Agent embedded directly inside the Celestial Wallet Chrome Extension. It bridges the gap between natural language and complex on-chain execution.

Instead of forcing users to navigate decentralized applications (dApps), manage ERC-20 approvals, and calculate gas limits, the user states an intent in plain English (e.g., "Migrate my portfolio to 0x...abc", "Swap 0.5 ETH for USDC"). The AI parses this text into a strict, machine-readable JSON object, constructs the necessary Ethereum Virtual Machine (EVM) transactions locally, and executes them utilizing a cryptographically isolated key vault.

The "Super-App" Model: By embedding the AI directly into the extension, the Agent gains secure, programmatic access to the ethers.js signer. This eliminates the "UX Nightmare" of constant third-party dApp popups while maintaining non-custodial security (keys never touch a cloud server).

2. CRYPTOGRAPHIC ISOLATION (THE DUAL-VAULT MODEL)

Security is the paramount concern. An autonomous agent cannot share the same private keys as a user's primary life savings. We enforce the Principle of Least Privilege using a Dual-Vault Architecture.

2.1 Storage Schema (chrome.storage.local)

The wallet utilizes two distinct storage keys. Both contain AES-GCM encrypted payloads requiring user decryption via password.

celestial_dex_vault: The primary manual wallet (Standard 360px extension).

celestial_agent_vault: The AI Agent's dedicated wallet (Expanded 800px dashboard).

2.2 The Agent Allowance Concept

When the user initializes the Agent, a completely new BIP-39 24-word seed phrase is generated. This creates a sandboxed wallet address. The user is instructed to send a small "allowance" (e.g., 0.1 ETH) to this Agent address. If the LLM hallucinates or a transaction fails, the maximum financial exposure is limited strictly to this allowance.

2.3 Decryption Flow

User opens the extension.

User toggles Mode (DEX vs. AGENT) on the Lock Screen.

User enters password.

Engine fetches the corresponding vault from storage.

Engine derives the symmetric key (PBKDF2 with salt).

Engine decrypts the vault to extract the raw mnemonic.

Engine injects the mnemonic into the ethers.js HDNodeWallet memory space.

Raw keys are NEVER written to state, localStorage, or passed to the LLM.

3. UI/UX & CONTEXT-AWARE EXTENSION RESIZING

Chrome extensions are heavily constrained by popup dimensions. The UI must adapt dynamically based on the active mode.

3.1 Lock Screen Toggle & Resizing

The LockScreen.tsx contains a premium segmented control.
When mode state changes, a useEffect dynamically modifies the DOM:

useEffect(() => {
  document.body.style.transition = 'width 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
  document.body.style.width = mode === 'DEX' ? '360px' : '800px';
  document.body.style.height = '600px'; 
}, [mode]);


3.2 Component Routing

DEX Mode -> Routes to standard Dashboard.tsx (Tokens, NFTs, standard Send/Receive).

AGENT Mode (No Vault) -> Routes to AgentOnboarding.tsx (Mnemonic generation, high-tech AI aesthetic).

AGENT Mode (Vault Exists) -> Routes to AgentDashboard.tsx (Chat interface, action cards, execution logs).

4. GLOBAL STATE MANAGEMENT (ZUSTAND)

The application state must cleanly separate the Agent's context from the DEX context.

import { create } from 'zustand';

interface Message {
  role: 'user' | 'assistant' | 'system' | 'action_card';
  content: string; // Text or stringified JSON depending on role
  timestamp: number;
}

interface AgentStore {
  // Vault & Auth State
  mode: 'DEX' | 'AGENT';
  isAgentUnlocked: boolean;
  agentAccount: { address: string, privateKey: string } | null;
  
  // Chat State
  messages: Message[];
  isThinking: boolean;
  
  // Execution State
  pendingIntent: ParsedIntent | null; 
  
  // Actions
  setMode: (mode: 'DEX' | 'AGENT') => void;
  unlockAgent: (account: any) => void;
  addMessage: (msg: Message) => void;
  setPendingIntent: (intent: ParsedIntent | null) => void;
}


5. THE LLM BRAIN (INTENT PARSING & STRUCTURED OUTPUTS)

The LLM is explicitly forbidden from operating as a conversational chatbot. It is a text-to-JSON parser.

5.1 System Prompt

You are the core logic engine for Celestial AI, a Web3 transaction agent.
Your sole purpose is to parse human text into executable blockchain intents.
NEVER return conversational text or markdown formatting.
Return ONLY a valid JSON object matching the exact schema provided.

Rules:
1. If you cannot extract a specific amount, assume "MAX".
2. If you cannot recognize the destination address or ENS, set intent to "UNKNOWN".
3. The "message" field is for a brief 1-sentence summary for the user to read before confirming.


5.2 Required JSON Output Schema (Zod/TypeScript Definition)

interface ParsedIntent {
  intent: "TRANSFER" | "SWAP" | "MIGRATE_ALL" | "UNKNOWN";
  transactions: {
    type: "ERC20_TRANSFER" | "NATIVE_TRANSFER" | "DEX_SWAP";
    tokenSymbol: string;      
    tokenAddress?: string;    // E.g., USDC contract address
    amount: string;           // "1.5" or "MAX"
    destination?: string;     // 0x... address
  }[];
  message: string;            // E.g., "Preparing to migrate 3 assets to 0x123..."
}


6. THE EXECUTION ENGINE (EVM TRANSACTION BUILDER)

Once the UI receives the ParsedIntent JSON from the LLM, the local execution engine takes over. The LLM does NOT execute code; it provides the blueprint.

6.1 Transaction Construction Loop

The React frontend maps the JSON payload to raw ethers.js transaction objects.

const buildTransactions = async (intent: ParsedIntent, provider: ethers.Provider) => {
    let txQueue = [];
    
    for (const tx of intent.transactions) {
        if (tx.type === 'NATIVE_TRANSFER') {
            txQueue.push({
                to: tx.destination,
                value: tx.amount === "MAX" ? await provider.getBalance(agentAddress) : ethers.parseEther(tx.amount),
                data: "0x"
            });
        }
        else if (tx.type === 'ERC20_TRANSFER') {
            const erc20 = new ethers.Contract(tx.tokenAddress, ERC20_ABI, provider);
            const decimals = await erc20.decimals();
            const data = erc20.interface.encodeFunctionData("transfer", [
                tx.destination,
                ethers.parseUnits(tx.amount, decimals)
            ]);
            txQueue.push({ to: tx.tokenAddress, value: 0, data: data });
        }
    }
    return txQueue;
}


6.2 The "Migrate All" Gas Sweeping Math (CRITICAL)

If intent === "MIGRATE_ALL", the engine must execute a complex sequence to drain the wallet without leaving dust or failing due to gas limits.

Index: Fetch all non-zero ERC-20 balances for the Agent address.

Estimate: Run provider.estimateGas() for every single ERC-20 transfer.

Sum Gas: Calculate total gas required for ERC-20s + 21,000 gas for the final Native (ETH) transfer.

Calculate Max Fee: Total Gas Required * feeData.maxFeePerGas.

Final Native Transfer: The final ETH transfer value MUST be exactly: Total Native Balance - Total Max Fee.

Queue: Place all ERC-20 transfers in the array first, and the calculated Native sweep transaction last.

6.3 Local Batch Execution

Once constructed, the UI displays an Action Card. Upon clicking "Confirm":

const executeQueue = async (txQueue, privateKey, provider) => {
    const wallet = new ethers.Wallet(privateKey, provider);
    let nonce = await provider.getTransactionCount(wallet.address);
    
    for (let i = 0; i < txQueue.length; i++) {
        const tx = { ...txQueue[i], nonce: nonce + i };
        const response = await wallet.sendTransaction(tx);
        await response.wait(); // Wait for confirmation
    }
}


7. UI/UX DESIGN SYSTEM (MIST GLASS)

All Agent interfaces must strictly adhere to the established "Mist Glass" dark mode aesthetic to maintain ecosystem consistency with Celestial Perps.

Backgrounds: Deep obsidian #0b0b0e.

Agent Chat Bubbles / Action Cards: Translucent dark gray bg-[#121212]/80 backdrop-blur-md with border border-white/10 and rounded-2xl.

User Chat Bubbles: Solid or highly visible bg-[#bb86fc]/20 text-white rounded-2xl border border-[#bb86fc]/30.

Action Buttons (Confirm): Neon Green bg-[#22c55e] text-black font-bold.

Action Buttons (Reject/Cancel): Red outline border border-[#ef4444] text-[#ef4444].

Animations: GSAP or Framer Motion for smooth message appearance and Action Card slide-ups.

8. SECURITY CONSTRAINTS & HARD RULES

NO RAW KEYS IN PROMPTS: The LLM API call must NEVER include the user's private key, seed phrase, or exact numerical balances. The LLM only knows the user's intent.

EXPLICIT CONFIRMATION: The Agent is strictly an "Assisted Agent". It cannot blind-sign. It must render the constructed txQueue in the UI and wait for the user to physically click "Confirm Execution".

GAS ESTIMATION FALLBACKS: If ethers.js gas estimation fails during buildTransactions (usually indicating the tx will revert on-chain), the UI must abort the process, clear the pendingIntent, and render an error message in the chat explaining why it cannot execute the request.