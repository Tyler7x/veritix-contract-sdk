/**
 * @module modules/splitter
 * Payment splitter operations exposed by the VeriTix Soroban contract.
 */

import { SorobanRpc, Keypair, Account, xdr, nativeToScVal } from '@stellar/stellar-sdk';
import { addressToScVal, bigintToScVal, scValToBigint } from '../utils/scval';
import { buildContractCall, submitTransaction, simulateTransaction } from '../utils/transaction';
import { parseSorobanError, VeriTixError, VeriTixErrorCode } from '../utils/errors';
import { parseSplitRecord } from '../utils/parsers';
import type {
  NetworkConfig,
  SplitRecord,
  SplitRecipient,
  TransactionResult,
  RevenueSplitParams,
  ValidationResult,
} from '../types/index';

export interface CreateSplitParams {
  recipients: SplitRecipient[];
  totalAmount: bigint;
}

export class SplitterModule {
  private readonly config: NetworkConfig;
  private readonly server: SorobanRpc.Server;
  private readonly keypair: Keypair | undefined;

  /** @internal */
  constructor(config: NetworkConfig, server: SorobanRpc.Server, keypair?: Keypair) {
    this.config = config;
    this.server = server;
    this.keypair = keypair;
  }

  // -------------------------------------------------------------------------
  // Read operations
  // -------------------------------------------------------------------------

  async getSplit(id: bigint): Promise<SplitRecord | null> {
    const sourceAccount = new Account(Keypair.random().publicKey(), '0');
    const tx = await buildContractCall(
      this.server, sourceAccount, this.config.contractId,
      'get_split', [bigintToScVal(id, 'u64')], this.config.networkPassphrase,
    );
    const raw = await this.server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(raw)) throw parseSorobanError(raw.error);
    const retval = SorobanRpc.Api.isSimulationSuccess(raw) && raw.result ? raw.result.retval : undefined;
    if (!retval || retval.switch() === xdr.ScValType.scvVoid()) return null;
    return parseSplitRecord(retval);
  }

  async getSplitsBySender(sender: string): Promise<bigint[]> {
    const sourceAccount = new Account(Keypair.random().publicKey(), '0');
    const tx = await buildContractCall(
      this.server, sourceAccount, this.config.contractId,
      'splits_by_sender', [addressToScVal(sender)], this.config.networkPassphrase,
    );
    const raw = await this.server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(raw)) return [];
    const retval = SorobanRpc.Api.isSimulationSuccess(raw) && raw.result ? raw.result.retval : undefined;
    if (!retval || retval.switch() !== xdr.ScValType.scvVec()) return [];
    return (retval.vec() ?? []).map((v) => scValToBigint(v));
  }

  async getSplitsForRecipient(address: string): Promise<bigint[]> {
    const sourceAccount = new Account(Keypair.random().publicKey(), '0');
    const tx = await buildContractCall(
      this.server, sourceAccount, this.config.contractId,
      'get_splits_for_recipient', [addressToScVal(address)], this.config.networkPassphrase,
    );
    const raw = await this.server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(raw)) return [];
    const retval = SorobanRpc.Api.isSimulationSuccess(raw) && raw.result ? raw.result.retval : undefined;
    if (!retval || retval.switch() !== xdr.ScValType.scvVec()) return [];
    return (retval.vec() ?? []).map((v) => scValToBigint(v));
  }

  validateRecipients(recipients: SplitRecipient[]): ValidationResult {
    const errors: string[] = [];
    recipients.forEach((r, i) => {
      if (r.shareBps <= 0) errors.push(`Recipient #${i + 1} has non-positive shareBps`);
    });
    const seen = new Set<string>();
    recipients.forEach((r) => {
      const lc = r.address.toLowerCase();
      if (seen.has(lc)) errors.push(`Duplicate address: ${r.address}`);
      seen.add(lc);
    });
    if (recipients.length > 20) errors.push(`Too many recipients: ${recipients.length} (max 20)`);
    const totalBps = recipients.reduce((sum, r) => sum + r.shareBps, 0);
    if (totalBps !== 10_000) errors.push(`Total BPS must equal 10 000, got ${totalBps}`);
    return { valid: errors.length === 0, errors };
  }

  // -------------------------------------------------------------------------
  // Write operations
  // -------------------------------------------------------------------------

  async createSplit(params: CreateSplitParams): Promise<TransactionResult> {
    if (!this.keypair) throw new Error('SplitterModule.createSplit: keypair required');
    const totalBps = params.recipients.reduce((s, r) => s + r.shareBps, 0);
    if (totalBps !== 10_000) {
      throw new VeriTixError(VeriTixErrorCode.SplitInvalidShares, 'Recipient shares must sum to 10 000 bps');
    }
    const recipientsScVal = xdr.ScVal.scvVec(
      params.recipients.map((r) =>
        xdr.ScVal.scvMap([
          new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('address'), val: addressToScVal(r.address) }),
          new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('share_bps'), val: nativeToScVal(r.shareBps, { type: 'u32' }) }),
        ])
      )
    );
    const sourceAccount = await this.server.getAccount(this.keypair.publicKey());
    const tx = await buildContractCall(
      this.server, sourceAccount, this.config.contractId,
      'create_split',
      [addressToScVal(this.keypair.publicKey()), recipientsScVal, bigintToScVal(params.totalAmount, 'i128')],
      this.config.networkPassphrase,
    );
    const { transaction } = await simulateTransaction(this.server, tx);
    return submitTransaction(this.server, transaction, this.keypair);
  }

  async createRevenueSplit(params: RevenueSplitParams): Promise<TransactionResult> {
    const { organizer, organizerBps, artist, artistBps, platform, totalAmount } = params;
    const totalBps = organizerBps + artistBps;
    if (totalBps >= 10_000) {
      throw new VeriTixError(VeriTixErrorCode.SplitInvalidShares,
        'Organizer and artist shares must sum to less than 10 000 bps.');
    }
    return this.createSplit({
      recipients: [
        { address: organizer, shareBps: organizerBps },
        { address: artist,   shareBps: artistBps },
        { address: platform, shareBps: 10_000 - totalBps },
      ],
      totalAmount,
    });
  }

  async distribute(_id: bigint): Promise<TransactionResult> {
    // TODO: implement
    throw new Error('SplitterModule.distribute: not implemented');
  }
}
