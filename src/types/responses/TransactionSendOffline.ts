

export enum SendOfflinePhase {
	SignatureRequired = 'SignatureRequired',
	TransactionReady = 'TransactionReady',
}

export interface UnsignedPayload {
	unsigned: string;
	session: string;
}

export interface ISendOfflineResult {
	phase: SendOfflinePhase;
	payload?: UnsignedPayload;
	tx?: string;
}
