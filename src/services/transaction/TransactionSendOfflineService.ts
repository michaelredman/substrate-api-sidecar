import type { SignerOptions, } from '@polkadot/api/submittable/types';
import { ApiPromise } from '@polkadot/api';
import { blake2AsHex } from '@polkadot/util-crypto';
import {
    ISendOfflineResult,
    SendOfflinePhase
} from '../../types/responses';
import {
    OfflineSigner,
    serialize,
    SignatureOptions,
    SignedPayload
} from '../../types/signer';
import { AbstractService } from '../AbstractService';
import { extractCauseAndStack } from './extractCauseAndStack';

interface TransactionSendOfflineSession {
    options: Partial<SignerOptions>
    expiry: number; // what time in ms is this to be cleared
}

interface TransactionSendOfflineCache {
    [key: string]: TransactionSendOfflineSession;
}

export class TransactionSendOfflineService extends AbstractService {

    private sessions: TransactionSendOfflineCache;

    constructor(api: ApiPromise) {
        super(api);
        this.sessions = {};
    }

    async createTransaction(
        account: string,
        target: string,
        params: string[],
        signature: SignedPayload,
    ): Promise<ISendOfflineResult> {
        const { api, sessions } = this;

        try {
            const [section, method] = target.split('.');
            const signer: OfflineSigner = new OfflineSigner(signature);
            const session: string = blake2AsHex(JSON.stringify({
                account: account,
                target: target,
                params: params,
                options: signature.options
            }))

            const signerOptions: Partial<SignerOptions> = sessions[session] ? sessions[session].options : {};
            const transaction: any = api.tx[section][method](...params);

            await transaction.signAsync(account, {
                ...signerOptions,
                signer
            });

            return {
                phase: SendOfflinePhase.TransactionReady,
                tx: transaction.toHex(),
            }
        } catch (err) {
            const { cause, stack } = extractCauseAndStack(err);

            throw {
                error: 'Unable to create transaction',
                cause,
                stack,
            };
        }
    }

    async createUnsignedPayload(
        account: string,
        target: string,
        params: string[],
    ): Promise<ISendOfflineResult> {
        const { api, sessions } = this;

        try {
            const [section, method] = target.split('.');
            const signer: OfflineSigner = new OfflineSigner();
            const signedBlock = await api.rpc.chain.getBlock();
            const signerOptions: Partial<SignerOptions> = {
                signer: signer,
                blockHash: signedBlock.block.header.hash,
                nonce: (await api.derive.balances.account(account)).accountNonce,
                era: api.createType('ExtrinsicEra', {
                    current: signedBlock.block.header.number,
                    period: 50
                }),
            }

            const transaction: any = api.tx[section][method](...params);

            await transaction.signAsync(account, signerOptions);

            const time: number = new Date().getTime();
            const options: SignatureOptions = serialize(signerOptions);

            for (const session in sessions) {
                if (sessions.hasOwnProperty(session)) {
                    if (sessions[session].expiry < time) {
                        delete sessions[session]; // do a lazy clear of the cache
                    }
                }
            }

            const session: string = blake2AsHex(JSON.stringify({
                account: account,
                target: target,
                params: params,
                options: options
            }))

            sessions[session] = {
                options: signerOptions,
                expiry: time + (24 * 60 * 60 * 1000) // 1 day
            }
            return {
                phase: SendOfflinePhase.SignatureRequired,
                payload: {
                    unsigned: signer.unsignedPayload(),
                    options: options // we want to dezerialize later..
                }
            }
        } catch (err) {
            const { cause, stack } = extractCauseAndStack(err);

            throw {
                error: 'Unable to sign request',
                cause,
                stack,
            };
        }
    }
}


