import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL,
  Keypair,
} from '@solana/web3.js'
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { IDL as RAW_IDL } from './idl/ponzimon'
import { createAssociatedTokenAccountInstruction, createTransferInstruction } from '@solana/spl-token'
import { GlobalState } from './types'

export const PONZIMON_PROGRAM_ID = new PublicKey(RAW_IDL.address)

export class PonzimonClient {
  constructor(public readonly connection: Connection, public readonly programId: PublicKey = PONZIMON_PROGRAM_ID) {}

  /* ----------------------------- PDA Helpers ----------------------------- */

  findGlobalState(tokenMint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from('global_state'), tokenMint.toBuffer()], this.programId)
  }

  findPlayer(playerWallet: PublicKey, tokenMint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('player'), playerWallet.toBuffer(), tokenMint.toBuffer()],
      this.programId
    )
  }

  findRewardsVault(tokenMint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from('rewards_vault'), tokenMint.toBuffer()], this.programId)
  }

  static async getFeesWallet(connection: Connection, programId: PublicKey, tokenMint: PublicKey): Promise<PublicKey> {
    // 這裡複製 findGlobalState 的邏輯
    const [globalPda] = PublicKey.findProgramAddressSync([Buffer.from('global_state'), tokenMint.toBuffer()], programId)
    const info = await connection.getAccountInfo(globalPda)
    if (!info) throw new Error('GlobalState not found')
    const offset = 8 + 32 + 32 // disc + authority + token_mint
    return new PublicKey(info.data.slice(offset, offset + 32))
  }

  /* --------------------------- Instruction builders --------------------------- */

  private async buildClaimRewardsIx(playerWallet: PublicKey, tokenMint: PublicKey): Promise<TransactionInstruction> {
    const [playerPda] = this.findPlayer(playerWallet, tokenMint)
    const [globalPda] = this.findGlobalState(tokenMint)
    const [rewardsVaultPda] = this.findRewardsVault(tokenMint)
    const playerTokenAta = await getAssociatedTokenAddress(tokenMint, playerWallet)

    const discriminator = Buffer.from([4, 144, 132, 71, 116, 23, 151, 80])

    return new TransactionInstruction({
      programId: this.programId,
      data: discriminator, // no args
      keys: [
        { pubkey: playerWallet, isSigner: true, isWritable: true },
        { pubkey: playerPda, isSigner: false, isWritable: true },
        { pubkey: globalPda, isSigner: false, isWritable: true },
        { pubkey: rewardsVaultPda, isSigner: false, isWritable: true },
        { pubkey: playerTokenAta, isSigner: false, isWritable: true },
        { pubkey: tokenMint, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
    })
  }

  private async buildPurchaseInitialFarmIx(
    playerWallet: PublicKey,
    tokenMint: PublicKey,
    feesWallet?: PublicKey,
    referrerWallet?: PublicKey
  ): Promise<TransactionInstruction> {
    if (!feesWallet) {
      feesWallet = await PonzimonClient.getFeesWallet(this.connection, this.programId, tokenMint)
    }
    // 如果沒有指定 referrer，使用 fees_wallet 作為 referrer
    if (!referrerWallet) {
      referrerWallet = feesWallet
    }

    const [playerPda] = this.findPlayer(playerWallet, tokenMint)
    const [globalPda] = this.findGlobalState(tokenMint)
    const playerTokenAta = await getAssociatedTokenAddress(tokenMint, playerWallet)

    const discriminator = Buffer.from([233, 62, 49, 138, 164, 181, 114, 69])

    return new TransactionInstruction({
      programId: this.programId,
      data: discriminator,
      keys: [
        { pubkey: playerWallet, isSigner: true, isWritable: true },
        { pubkey: playerPda, isSigner: false, isWritable: true },
        { pubkey: globalPda, isSigner: false, isWritable: true },
        { pubkey: feesWallet, isSigner: false, isWritable: true },
        { pubkey: referrerWallet, isSigner: false, isWritable: true }, // 使用實際的 referrer_wallet
        { pubkey: tokenMint, isSigner: false, isWritable: true }, // 修正：tokenMint 應該是 writable
        { pubkey: playerTokenAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }, // rent sysvar
      ],
    })
  }

  private async buildStakeCardIx(
    playerWallet: PublicKey,
    tokenMint: PublicKey,
    cardIndex: number
  ): Promise<TransactionInstruction> {
    const [playerPda] = this.findPlayer(playerWallet, tokenMint)
    const [globalPda] = this.findGlobalState(tokenMint)
    const [rewardsVaultPda] = this.findRewardsVault(tokenMint)
    const playerTokenAta = await getAssociatedTokenAddress(tokenMint, playerWallet)
    const discriminator = Buffer.from([97, 111, 171, 186, 179, 198, 68, 172])
    const data = Buffer.concat([discriminator, Buffer.from([cardIndex])])
    return new TransactionInstruction({
      programId: this.programId,
      data,
      keys: [
        { pubkey: playerWallet, isSigner: true, isWritable: true },
        { pubkey: playerPda, isSigner: false, isWritable: true },
        { pubkey: globalPda, isSigner: false, isWritable: true },
        { pubkey: rewardsVaultPda, isSigner: false, isWritable: true },
        { pubkey: tokenMint, isSigner: false, isWritable: false },
        { pubkey: playerTokenAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
    })
  }

  private async buildUnstakeCardIx(
    playerWallet: PublicKey,
    tokenMint: PublicKey,
    cardIndex: number
  ): Promise<TransactionInstruction> {
    const [playerPda] = this.findPlayer(playerWallet, tokenMint)
    const [globalPda] = this.findGlobalState(tokenMint)
    const [rewardsVaultPda] = this.findRewardsVault(tokenMint)
    const playerTokenAta = await getAssociatedTokenAddress(tokenMint, playerWallet)
    const discriminator = Buffer.from([228, 178, 159, 183, 119, 1, 197, 222])
    const data = Buffer.concat([discriminator, Buffer.from([cardIndex])])
    return new TransactionInstruction({
      programId: this.programId,
      data,
      keys: [
        { pubkey: playerWallet, isSigner: true, isWritable: true },
        { pubkey: playerPda, isSigner: false, isWritable: true },
        { pubkey: globalPda, isSigner: false, isWritable: true },
        { pubkey: rewardsVaultPda, isSigner: false, isWritable: true },
        { pubkey: tokenMint, isSigner: false, isWritable: false },
        { pubkey: playerTokenAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
    })
  }

  private async buildOpenBoosterCommitIx(
    playerWallet: PublicKey,
    tokenMint: PublicKey,
    playerTokenAta: PublicKey,
    feesTokenAta: PublicKey,
    referrerTokenAta?: PublicKey
  ): Promise<TransactionInstruction> {
    const [playerPda] = this.findPlayer(playerWallet, tokenMint)
    const [globalPda] = this.findGlobalState(tokenMint)
    const [rewardsVaultPda] = this.findRewardsVault(tokenMint)
    const discriminator = Buffer.from([7, 252, 135, 223, 242, 236, 242, 93])

    // 構建基本帳戶列表
    const accounts = [
      { pubkey: playerWallet, isSigner: true, isWritable: true },
      { pubkey: playerPda, isSigner: false, isWritable: true },
      { pubkey: globalPda, isSigner: false, isWritable: true },
      { pubkey: rewardsVaultPda, isSigner: false, isWritable: true },
      { pubkey: playerTokenAta, isSigner: false, isWritable: true },
      { pubkey: feesTokenAta, isSigner: false, isWritable: true },
    ]

    // 只有在 referrerTokenAta 存在時才添加
    if (referrerTokenAta) {
      accounts.push({ pubkey: referrerTokenAta, isSigner: false, isWritable: true })
    }

    // 添加其餘必需帳戶
    accounts.push(
      { pubkey: tokenMint, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
    )

    return new TransactionInstruction({
      programId: this.programId,
      data: discriminator,
      keys: accounts,
    })
  }

  private async buildSettleOpenBoosterIx(
    playerWallet: PublicKey,
    tokenMint: PublicKey
  ): Promise<TransactionInstruction> {
    const [playerPda] = this.findPlayer(playerWallet, tokenMint)
    const [globalPda] = this.findGlobalState(tokenMint)
    const [rewardsVaultPda] = this.findRewardsVault(tokenMint)
    const playerTokenAta = await getAssociatedTokenAddress(tokenMint, playerWallet)
    const discriminator = Buffer.from([228, 144, 199, 56, 94, 223, 9, 226])
    return new TransactionInstruction({
      programId: this.programId,
      data: discriminator,
      keys: [
        { pubkey: playerWallet, isSigner: true, isWritable: true },
        { pubkey: playerPda, isSigner: false, isWritable: true },
        { pubkey: globalPda, isSigner: false, isWritable: true },
        { pubkey: rewardsVaultPda, isSigner: false, isWritable: true },
        { pubkey: playerTokenAta, isSigner: false, isWritable: true },
        { pubkey: tokenMint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        {
          pubkey: new PublicKey('SysvarS1otHashes111111111111111111111111111'),
          isSigner: false,
          isWritable: false,
        },
      ],
    })
  }

  /* --------------------------- Public Actions --------------------------- */

  private async ensureTokenAccountExists(playerWallet: PublicKey, tokenMint: PublicKey): Promise<TransactionInstruction | null> {
    const playerTokenAta = await getAssociatedTokenAddress(tokenMint, playerWallet)
    const accountInfo = await this.connection.getAccountInfo(playerTokenAta)
    
    if (accountInfo) {
      return null // Account already exists
    }
    
    // Create the associated token account
    return createAssociatedTokenAccountInstruction(
      playerWallet,
      playerTokenAta,
      playerWallet,
      tokenMint
    )
  }

  // Alternative method: Create token account separately
  async createTokenAccount(playerKeypair: Keypair, tokenMint: PublicKey): Promise<string> {
    const playerTokenAta = await getAssociatedTokenAddress(tokenMint, playerKeypair.publicKey)
    const accountInfo = await this.connection.getAccountInfo(playerTokenAta)
    
    if (accountInfo) {
      throw new Error('Token account already exists')
    }
    
    const createAtaIx = createAssociatedTokenAccountInstruction(
      playerKeypair.publicKey,
      playerTokenAta,
      playerKeypair.publicKey,
      tokenMint
    )
    
    const tx = new Transaction().add(createAtaIx)
    const sig = await this.connection.sendTransaction(tx, [playerKeypair])
    return sig
  }

  async claimRewards(playerKeypair: Keypair, tokenMint: PublicKey) {
    // First, ensure the token account exists
    const createAtaIx = await this.ensureTokenAccountExists(playerKeypair.publicKey, tokenMint)
    const claimIx = await this.buildClaimRewardsIx(playerKeypair.publicKey, tokenMint)

    const tx = new Transaction()
    
    // Add compute budget instructions
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 })
    )
    
    // Add create ATA instruction if needed
    if (createAtaIx) {
      tx.add(createAtaIx)
    }
    
    // Add claim rewards instruction
    tx.add(claimIx)

    const sig = await this.connection.sendTransaction(tx, [playerKeypair])
    return sig
  }

  async purchaseInitialFarm(playerKeypair: Keypair, tokenMint: PublicKey, referrerWallet?: PublicKey) {
    const ix = await this.buildPurchaseInitialFarmIx(playerKeypair.publicKey, tokenMint, undefined, referrerWallet)

    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
      ix
    )

    const sig = await this.connection.sendTransaction(tx, [playerKeypair])
    return sig
  }

  async stakeCard(playerKeypair: Keypair, tokenMint: PublicKey, cardIndex: number) {
    const createAtaIx = await this.ensureTokenAccountExists(playerKeypair.publicKey, tokenMint)
    const stakeIx = await this.buildStakeCardIx(playerKeypair.publicKey, tokenMint, cardIndex)
    
    const tx = new Transaction()
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
    
    if (createAtaIx) {
      tx.add(createAtaIx)
    }
    
    tx.add(stakeIx)
    const sig = await this.connection.sendTransaction(tx, [playerKeypair])
    return sig
  }

  async unstakeCard(playerKeypair: Keypair, tokenMint: PublicKey, cardIndex: number) {
    const createAtaIx = await this.ensureTokenAccountExists(playerKeypair.publicKey, tokenMint)
    const unstakeIx = await this.buildUnstakeCardIx(playerKeypair.publicKey, tokenMint, cardIndex)
    
    const tx = new Transaction()
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
    
    if (createAtaIx) {
      tx.add(createAtaIx)
    }
    
    tx.add(unstakeIx)
    const sig = await this.connection.sendTransaction(tx, [playerKeypair])
    return sig
  }

  async openBoosterCommit(
    playerKeypair: Keypair,
    tokenMint: PublicKey,
    feesTokenAta: PublicKey,
    referrerTokenAta?: PublicKey
  ) {
    const playerTokenAta = await getAssociatedTokenAddress(tokenMint, playerKeypair.publicKey)
    const ix = await this.buildOpenBoosterCommitIx(
      playerKeypair.publicKey,
      tokenMint,
      playerTokenAta,
      feesTokenAta,
      referrerTokenAta
    )
    const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), ix)
    const sig = await this.connection.sendTransaction(tx, [playerKeypair])
    return sig
  }

  async settleOpenBooster(playerKeypair: Keypair, tokenMint: PublicKey) {
    const createAtaIx = await this.ensureTokenAccountExists(playerKeypair.publicKey, tokenMint)
    const settleIx = await this.buildSettleOpenBoosterIx(playerKeypair.publicKey, tokenMint)
    
    const tx = new Transaction()
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
    
    if (createAtaIx) {
      tx.add(createAtaIx)
    }
    
    tx.add(settleIx)
    const sig = await this.connection.sendTransaction(tx, [playerKeypair])
    return sig
  }

  async upgradeFarm(playerKeypair: Keypair, tokenMint: PublicKey, farmType: number) {
    const createAtaIx = await this.ensureTokenAccountExists(playerKeypair.publicKey, tokenMint)
    const upgradeIx = await this.buildUpgradeFarmIx(playerKeypair.publicKey, tokenMint, farmType)
    
    const tx = new Transaction()
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 })
    )
    
    if (createAtaIx) {
      tx.add(createAtaIx)
    }
    
    tx.add(upgradeIx)
    const sig = await this.connection.sendTransaction(tx, [playerKeypair])
    return sig
  }

  private async buildUpgradeFarmIx(
    playerWallet: PublicKey,
    tokenMint: PublicKey,
    farmType: number
  ): Promise<TransactionInstruction> {
    const [playerPda] = this.findPlayer(playerWallet, tokenMint)
    const [globalPda] = this.findGlobalState(tokenMint)
    const [rewardsVaultPda] = this.findRewardsVault(tokenMint)
    const playerTokenAta = await getAssociatedTokenAddress(tokenMint, playerWallet)
    const feesWallet = await PonzimonClient.getFeesWallet(this.connection, this.programId, tokenMint)
    const feesTokenAta = await getAssociatedTokenAddress(tokenMint, feesWallet)

    // upgrade_farm 指令鑑別器: [110, 239, 193, 1, 165, 101, 54, 200]
    const discriminator = Buffer.from([110, 239, 193, 1, 165, 101, 54, 200])
    const data = Buffer.concat([discriminator, Buffer.from([farmType])])

    return new TransactionInstruction({
      programId: this.programId,
      data,
      keys: [
        { pubkey: playerWallet, isSigner: true, isWritable: true },
        { pubkey: playerPda, isSigner: false, isWritable: true },
        { pubkey: globalPda, isSigner: false, isWritable: true },
        { pubkey: rewardsVaultPda, isSigner: false, isWritable: true },
        { pubkey: playerTokenAta, isSigner: false, isWritable: true },
        { pubkey: feesTokenAta, isSigner: false, isWritable: true },
        { pubkey: tokenMint, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
    })
  }

  async recycleCardsCommit(playerKeypair: Keypair, tokenMint: PublicKey, cardIndices: number[]) {
    const playerTokenAta = await getAssociatedTokenAddress(tokenMint, playerKeypair.publicKey)
    const ataInfo = await this.connection.getAccountInfo(playerTokenAta)
    const instructions: TransactionInstruction[] = []
    if (!ataInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          playerKeypair.publicKey, // payer
          playerTokenAta,
          playerKeypair.publicKey,
          tokenMint
        )
      )
    }
    const ix = await this.buildRecycleCardsCommitIx(playerKeypair.publicKey, tokenMint, cardIndices)
    instructions.push(ix)
    const tx = new Transaction().add(...instructions)
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 })
    )
    const sig = await this.connection.sendTransaction(tx, [playerKeypair])
    return sig
  }

  async recycleCardsSettle(playerKeypair: Keypair, tokenMint: PublicKey) {
    const createAtaIx = await this.ensureTokenAccountExists(playerKeypair.publicKey, tokenMint)
    const settleIx = await this.buildRecycleCardsSettleIx(playerKeypair.publicKey, tokenMint)
    
    const tx = new Transaction()
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 })
    )
    
    if (createAtaIx) {
      tx.add(createAtaIx)
    }
    
    tx.add(settleIx)
    const sig = await this.connection.sendTransaction(tx, [playerKeypair])
    return sig
  }

  private async buildRecycleCardsCommitIx(
    playerWallet: PublicKey,
    tokenMint: PublicKey,
    cardIndices: number[]
  ): Promise<TransactionInstruction> {
    const [playerPda] = this.findPlayer(playerWallet, tokenMint)
    const [globalPda] = this.findGlobalState(tokenMint)
    const [rewardsVaultPda] = this.findRewardsVault(tokenMint)
    const playerTokenAta = await getAssociatedTokenAddress(tokenMint, playerWallet)

    // recycle_cards_commit 指令鑑別器: [199, 209, 96, 199, 205, 57, 66, 239]
    const discriminator = Buffer.from([199, 209, 96, 199, 205, 57, 66, 239])
    // 正確打包 bytes: 先寫入長度（u32 LE），再寫入內容
    const indices = Buffer.from(cardIndices)
    const len = Buffer.alloc(4)
    len.writeUInt32LE(indices.length, 0)
    const data = Buffer.concat([discriminator, len, indices])

    return new TransactionInstruction({
      programId: this.programId,
      data,
      keys: [
        { pubkey: playerWallet, isSigner: true, isWritable: true },
        { pubkey: playerPda, isSigner: false, isWritable: true },
        { pubkey: globalPda, isSigner: false, isWritable: true },
        { pubkey: rewardsVaultPda, isSigner: false, isWritable: true },
        { pubkey: playerTokenAta, isSigner: false, isWritable: true },
        { pubkey: tokenMint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
    })
  }

  private async buildRecycleCardsSettleIx(
    playerWallet: PublicKey,
    tokenMint: PublicKey
  ): Promise<TransactionInstruction> {
    const [playerPda] = this.findPlayer(playerWallet, tokenMint)
    const [globalPda] = this.findGlobalState(tokenMint)
    const [rewardsVaultPda] = this.findRewardsVault(tokenMint)
    const playerTokenAta = await getAssociatedTokenAddress(tokenMint, playerWallet)

    // recycle_cards_settle 指令鑑別器: [43, 187, 33, 249, 184, 225, 127, 143]
    const discriminator = Buffer.from([43, 187, 33, 249, 184, 225, 127, 143])

    return new TransactionInstruction({
      programId: this.programId,
      data: discriminator,
      keys: [
        { pubkey: playerWallet, isSigner: true, isWritable: true },
        { pubkey: playerPda, isSigner: false, isWritable: true },
        { pubkey: globalPda, isSigner: false, isWritable: true },
        { pubkey: rewardsVaultPda, isSigner: false, isWritable: true },
        { pubkey: playerTokenAta, isSigner: false, isWritable: true },
        { pubkey: tokenMint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: new PublicKey('SysvarS1otHashes111111111111111111111111111'), isSigner: false, isWritable: false },
      ],
    })
  }

  async transferSOL(fromKeypair: Keypair, toAddress: PublicKey, amount?: number) {
    const connection = this.connection
    const fromAddress = fromKeypair.publicKey

    // 如果沒有指定金額，轉移全部餘額減去手續費
    let transferAmount: number
    if (amount) {
      transferAmount = amount * LAMPORTS_PER_SOL
    } else {
      const balance = await connection.getBalance(fromAddress)
      transferAmount = balance - 5000 // 保留 5000 lamports 作為手續費
    }

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: fromAddress,
        toPubkey: toAddress,
        lamports: transferAmount,
      })
    )

    const sig = await connection.sendTransaction(transaction, [fromKeypair])
    return sig
  }

  async transferPoke(fromKeypair: Keypair, toAddress: PublicKey, tokenMint: PublicKey, amount?: number) {
    const connection = this.connection
    const fromAddress = fromKeypair.publicKey

    // 獲取源和目標的 token account
    const fromTokenAccount = await getAssociatedTokenAddress(tokenMint, fromAddress)
    const toTokenAccount = await getAssociatedTokenAddress(tokenMint, toAddress)

    // 檢查目標 token account 是否存在，如果不存在則創建
    const toAccountInfo = await connection.getAccountInfo(toTokenAccount)
    const instructions: TransactionInstruction[] = []

    if (!toAccountInfo) {
      instructions.push(createAssociatedTokenAccountInstruction(fromAddress, toTokenAccount, toAddress, tokenMint))
    }

    // 獲取餘額
    const balance = await connection.getTokenAccountBalance(fromTokenAccount)
    const tokenAmount = amount || balance.value.uiAmount || 0
    if (!tokenAmount || tokenAmount <= 0) {
      throw new Error('Poke 餘額不足，跳過轉帳')
    }
    // 添加轉帳指令
    instructions.push(
      createTransferInstruction(
        fromTokenAccount,
        toTokenAccount,
        fromAddress,
        Math.floor(tokenAmount * Math.pow(10, balance.value.decimals))
      )
    )

    const transaction = new Transaction().add(...instructions)
    const sig = await connection.sendTransaction(transaction, [fromKeypair])
    return sig
  }

  // 批量转账优化方法 - 将多个转账绑定在一个交易中
  async batchTransferPoke(
    transfers: Array<{
      fromKeypair: Keypair
      toAddress: PublicKey
      amount?: number
    }>,
    tokenMint: PublicKey,
    maxTransfersPerTx: number = 5,
    useBatchMode: boolean = false
  ) {
    if (useBatchMode) {
      // 真正的批量模式：所有转账在同一个交易中（需要所有签名者同时在线）
      return this.executeBatchTransfer(transfers, tokenMint, maxTransfersPerTx)
    } else {
      // 串行模式：每个转账单独交易（适合实际使用场景）
      return this.executeSerialTransfer(transfers, tokenMint)
    }
  }

  // 真正的批量转账模式（需要所有签名者同时在线）
  private async executeBatchTransfer(
    transfers: Array<{
      fromKeypair: Keypair
      toAddress: PublicKey
      amount?: number
    }>,
    tokenMint: PublicKey,
    maxTransfersPerTx: number
  ) {
    const connection = this.connection
    const results: Array<{ success: boolean; signature?: string; error?: string; fromAddress: string }> = []
    const { delay } = await import('@/lib/utils/rate-limiter')

    // 按批次处理转账
    for (let i = 0; i < transfers.length; i += maxTransfersPerTx) {
      const batch = transfers.slice(i, i + maxTransfersPerTx)

      try {
        // 为每个批次创建一个交易
        const transaction = new Transaction()
        const allSigners: Keypair[] = []
        const batchResults: Array<{ success: boolean; signature?: string; error?: string; fromAddress: string }> = []

        // 批量获取所有需要的信息，减少RPC请求
        const targetAddresses = new Set<string>()
        const fromAddresses = new Set<string>()
        const transferMap = new Map<
          string,
          { transfer: (typeof transfers)[0]; fromAddress: string; toAddress: string }
        >()

        // 收集所有地址
        batch.forEach((transfer) => {
          const fromAddr = transfer.fromKeypair.publicKey.toBase58()
          const toAddr = transfer.toAddress.toBase58()
          targetAddresses.add(toAddr)
          fromAddresses.add(fromAddr)
          transferMap.set(fromAddr, { transfer, fromAddress: fromAddr, toAddress: toAddr })
        })

        // 获取限流配置
        const { useAppStore } = await import('@/store')
        const state = useAppStore.getState()
        const rateLimit = state.config.rateLimit

        // 批量获取目标Token账户信息（使用限流）
        const targetAccountInfos = []
        for (const targetAddr of targetAddresses) {
          try {
            const targetAddress = new PublicKey(targetAddr)
            const toTokenAccount = await getAssociatedTokenAddress(tokenMint, targetAddress)
            const toAccountInfo = await connection.getAccountInfo(toTokenAccount)
            targetAccountInfos.push({ targetAddr, toTokenAccount, toAccountInfo })

            // 使用配置的延迟时间
            if (rateLimit.delayMs > 0) {
              await delay(rateLimit.delayMs)
            }
          } catch (error) {
            console.warn(`获取目标账户信息失败: ${targetAddr}`, error)
            targetAccountInfos.push({ targetAddr, toTokenAccount: null, toAccountInfo: null })
          }
        }

        // 批量获取源Token账户余额（使用限流）
        const sourceAccountInfos = []
        for (const fromAddr of fromAddresses) {
          try {
            const fromAddress = new PublicKey(fromAddr)
            const fromTokenAccount = await getAssociatedTokenAddress(tokenMint, fromAddress)
            const balance = await connection.getTokenAccountBalance(fromTokenAccount)
            sourceAccountInfos.push({ fromAddr, fromTokenAccount, balance })

            // 使用配置的延迟时间
            if (rateLimit.delayMs > 0) {
              await delay(rateLimit.delayMs)
            }
          } catch (error) {
            console.warn(`获取源账户余额失败: ${fromAddr}`, error)
            sourceAccountInfos.push({ fromAddr, fromTokenAccount: null, balance: null })
          }
        }

        // 创建源账户信息映射
        const sourceMap = new Map(sourceAccountInfos.map((info) => [info.fromAddr, info]))
        const targetMap = new Map(targetAccountInfos.map((info) => [info.targetAddr, info]))

        // 检查并创建目标Token账户
        for (const { targetAddr, toTokenAccount, toAccountInfo } of targetAccountInfos) {
          if (toTokenAccount && !toAccountInfo) {
            // 使用第一个转账者作为创建者
            const creator = batch[0].fromKeypair
            transaction.add(
              createAssociatedTokenAccountInstruction(
                creator.publicKey,
                toTokenAccount,
                new PublicKey(targetAddr),
                tokenMint
              )
            )
          }
        }

        // 添加所有转账指令
        for (const [fromAddr, { transfer, toAddress }] of transferMap) {
          try {
            const sourceInfo = sourceMap.get(fromAddr)
            const targetInfo = targetMap.get(toAddress)

            if (!sourceInfo || !sourceInfo.fromTokenAccount || !sourceInfo.balance) {
              batchResults.push({
                success: false,
                error: '無法獲取源賬戶信息',
                fromAddress: fromAddr,
              })
              continue
            }

            if (!targetInfo || !targetInfo.toTokenAccount) {
              batchResults.push({
                success: false,
                error: '無法獲取目標賬戶信息',
                fromAddress: fromAddr,
              })
              continue
            }

            const tokenAmount = transfer.amount || sourceInfo.balance.value.uiAmount || 0

            if (!tokenAmount || tokenAmount <= 0) {
              batchResults.push({
                success: false,
                error: 'Poke 餘額不足',
                fromAddress: fromAddr,
              })
              continue
            }

            // 添加转账指令
            transaction.add(
              createTransferInstruction(
                sourceInfo.fromTokenAccount,
                targetInfo.toTokenAccount,
                new PublicKey(fromAddr),
                Math.floor(tokenAmount * Math.pow(10, sourceInfo.balance.value.decimals))
              )
            )

            allSigners.push(transfer.fromKeypair)
            batchResults.push({
              success: true,
              fromAddress: fromAddr,
            })
          } catch (error) {
            batchResults.push({
              success: false,
              error: error instanceof Error ? error.message : String(error),
              fromAddress: fromAddr,
            })
          }
        }

        // 优化计算单位使用
        const instructionCount = transaction.instructions.length
        const estimatedComputeUnits = Math.min(
          200_000 + instructionCount * 10_000, // 基础200K + 每个指令10K
          1_400_000 // 最大限制
        )

        // 添加计算单位控制指令
        transaction.add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: estimatedComputeUnits }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 })
        )

        // 发送批量交易
        if (transaction.instructions.length > 0) {
          const sig = await connection.sendTransaction(transaction, allSigners)

          // 更新成功的结果
          batchResults.forEach((result) => {
            if (result.success) {
              result.signature = sig
            }
          })
        }

        results.push(...batchResults)

        // 批次间延迟，使用配置的延迟时间
        if (i + maxTransfersPerTx < transfers.length && rateLimit.delayMs > 0) {
          await delay(rateLimit.delayMs)
        }
      } catch (error) {
        // 如果批量交易失败，回退到单个交易
        console.warn('批量交易失败，回退到单个交易:', error)
        for (const transfer of batch) {
          try {
            const sig = await this.transferPoke(transfer.fromKeypair, transfer.toAddress, tokenMint, transfer.amount)
            results.push({
              success: true,
              signature: sig,
              fromAddress: transfer.fromKeypair.publicKey.toBase58(),
            })
          } catch (transferError) {
            results.push({
              success: false,
              error: transferError instanceof Error ? transferError.message : String(transferError),
              fromAddress: transfer.fromKeypair.publicKey.toBase58(),
            })
          }
        }
      }
    }

    return results
  }

  // 串行转账模式（适合实际使用场景）
  private async executeSerialTransfer(
    transfers: Array<{
      fromKeypair: Keypair
      toAddress: PublicKey
      amount?: number
    }>,
    tokenMint: PublicKey
  ) {
    const results: Array<{ success: boolean; signature?: string; error?: string; fromAddress: string }> = []
    const { delay } = await import('@/lib/utils/rate-limiter')

    // 获取限流配置
    const { useAppStore } = await import('@/store')
    const state = useAppStore.getState()
    const rateLimit = state.config.rateLimit

    // 串行处理每个转账
    for (const transfer of transfers) {
      try {
        const sig = await this.transferPoke(transfer.fromKeypair, transfer.toAddress, tokenMint, transfer.amount)
        results.push({
          success: true,
          signature: sig,
          fromAddress: transfer.fromKeypair.publicKey.toBase58(),
        })

        // 转账间延迟，使用配置的延迟时间
        if (rateLimit.delayMs > 0) {
          await delay(rateLimit.delayMs)
        }
      } catch (error) {
        results.push({
          success: false,
          error: error instanceof Error ? error.message : String(error),
          fromAddress: transfer.fromKeypair.publicKey.toBase58(),
        })
      }
    }

    return results
  }

  // 新增：取消 pending action
  async cancelPendingAction(playerKeypair: Keypair, tokenMint: PublicKey) {
    // CancelPendingAction 指令 discriminator: [218, 126, 76, 224, 30, 9, 86, 114]
    const [playerPda] = this.findPlayer(playerKeypair.publicKey, tokenMint)
    const [globalPda] = this.findGlobalState(tokenMint)
    const [rewardsVaultPda] = this.findRewardsVault(tokenMint)
    const playerTokenAta = await getAssociatedTokenAddress(tokenMint, playerKeypair.publicKey)
    const discriminator = Buffer.from([218, 126, 76, 224, 30, 9, 86, 114])
    const ix = new TransactionInstruction({
      programId: this.programId,
      data: discriminator,
      keys: [
        { pubkey: playerKeypair.publicKey, isSigner: true, isWritable: true }, // player_wallet
        { pubkey: playerPda, isSigner: false, isWritable: true }, // player
        { pubkey: globalPda, isSigner: false, isWritable: true }, // global_state
        { pubkey: rewardsVaultPda, isSigner: false, isWritable: true }, // rewards_vault
        { pubkey: playerTokenAta, isSigner: false, isWritable: true }, // player_token_account
        { pubkey: tokenMint, isSigner: false, isWritable: false }, // token_mint
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program
      ],
    })
    const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }), ix)
    const sig = await this.connection.sendTransaction(tx, [playerKeypair])
    return sig
  }

  // 新增：取得 GlobalState
  async getGlobalState(tokenMint: PublicKey): Promise<GlobalState> {
    const [globalPda] = this.findGlobalState(tokenMint)
    const info = await this.connection.getAccountInfo(globalPda)
    if (!info) throw new Error('GlobalState not found')
    // 解析 GlobalState 結構（根據 types.ts 定義）
    // 8 bytes discriminator + 32 authority + 32 token_mint + 32 fees_wallet = 104
    let offset = 8
    const authority = new PublicKey(info.data.slice(offset, offset + 32)).toBase58()
    offset += 32
    const token_mint = new PublicKey(info.data.slice(offset, offset + 32)).toBase58()
    offset += 32
    const fees_wallet = new PublicKey(info.data.slice(offset, offset + 32)).toBase58()
    offset += 32
    const total_supply = info.data.readBigUInt64LE(offset).toString()
    offset += 8
    const burned_tokens = info.data.readBigUInt64LE(offset).toString()
    offset += 8
    const cumulative_rewards = info.data.readBigUInt64LE(offset).toString()
    offset += 8
    const start_slot = info.data.readBigUInt64LE(offset).toString()
    offset += 8
    const reward_rate = info.data.readBigUInt64LE(offset).toString()
    offset += 8
    // u128: 低位在前，高位在後
    const acc_tokens_per_hashpower = (
      info.data.readBigUInt64LE(offset) +
      info.data.readBigUInt64LE(offset + 8) * BigInt('18446744073709551616')
    ).toString()
    offset += 16
    const last_reward_slot = info.data.readBigUInt64LE(offset).toString()
    offset += 8
    const burn_rate = info.data.readUInt8(offset)
    offset += 1
    const referral_fee = info.data.readUInt8(offset)
    offset += 1
    const production_enabled = info.data.readUInt8(offset) !== 0
    offset += 1
    const dust_threshold_divisor = info.data.readBigUInt64LE(offset).toString()
    offset += 8
    const initial_farm_purchase_fee_lamports = info.data.readBigUInt64LE(offset).toString()
    offset += 8
    const booster_pack_cost_microtokens = info.data.readBigUInt64LE(offset).toString()
    offset += 8
    const gamble_fee_lamports = info.data.readBigUInt64LE(offset).toString()
    offset += 8
    const total_berries = info.data.readBigUInt64LE(offset).toString()
    offset += 8
    const total_hashpower = info.data.readBigUInt64LE(offset).toString()
    offset += 8
    const total_global_gambles = info.data.readBigUInt64LE(offset).toString()
    offset += 8
    const total_global_gamble_wins = info.data.readBigUInt64LE(offset).toString()
    offset += 8
    const total_booster_packs_opened = info.data.readBigUInt64LE(offset).toString()
    offset += 8
    const total_card_recycling_attempts = info.data.readBigUInt64LE(offset).toString()
    offset += 8
    const total_successful_card_recycling = info.data.readBigUInt64LE(offset).toString()
    offset += 8
    const total_staked_tokens = info.data.readBigUInt64LE(offset).toString()
    offset += 8
    const staking_lockup_slots = info.data.readBigUInt64LE(offset).toString()
    offset += 8
    // u128: 低位在前，高位在後
    const acc_sol_rewards_per_token = (
      info.data.readBigUInt64LE(offset) +
      info.data.readBigUInt64LE(offset + 8) * BigInt('18446744073709551616')
    ).toString()
    offset += 16
    const acc_token_rewards_per_token = (
      info.data.readBigUInt64LE(offset) +
      info.data.readBigUInt64LE(offset + 8) * BigInt('18446744073709551616')
    ).toString()
    offset += 16
    const last_staking_reward_slot = info.data.readBigUInt64LE(offset).toString()
    offset += 8
    const token_reward_rate = info.data.readBigUInt64LE(offset).toString()
    offset += 8
    const total_sol_deposited = info.data.readBigUInt64LE(offset).toString()
    offset += 8
    const rewards_vault = new PublicKey(info.data.slice(offset, offset + 32)).toBase58()
    offset += 32
    // 跳過 padding
    return {
      authority,
      token_mint,
      fees_wallet,
      total_supply,
      burned_tokens,
      cumulative_rewards,
      start_slot,
      reward_rate,
      acc_tokens_per_hashpower,
      last_reward_slot,
      burn_rate,
      referral_fee,
      production_enabled,
      dust_threshold_divisor,
      initial_farm_purchase_fee_lamports,
      booster_pack_cost_microtokens,
      gamble_fee_lamports,
      total_berries,
      total_hashpower,
      total_global_gambles,
      total_global_gamble_wins,
      total_booster_packs_opened,
      total_card_recycling_attempts,
      total_successful_card_recycling,
      total_staked_tokens,
      staking_lockup_slots,
      acc_sol_rewards_per_token,
      acc_token_rewards_per_token,
      last_staking_reward_slot,
      token_reward_rate,
      total_sol_deposited,
      rewards_vault,
    }
  }
}
