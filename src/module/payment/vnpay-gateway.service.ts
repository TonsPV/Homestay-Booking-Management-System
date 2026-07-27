import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildPaymentUrlSearchParams,
  calculateSecureHash,
  HashAlgorithm,
  ProductCode,
  RefundTransactionType,
  VNPay,
  VnpLocale,
} from 'vnpay';
import type { QueryDrResponse, ReturnQueryFromVNPay } from 'vnpay';

interface CreateVnPayUrlInput {
  amount: string;
  transactionReference: string;
  orderInfo: string;
  ipAddress: string | undefined;
  locale: 'vn' | 'en';
  bankCode: VnPayBankCode | undefined;
  createdAt: Date;
  expiresAt: Date;
}

export interface VnPayTransactionOperationInput {
  amount: string;
  transactionReference: string;
  transactionId: string;
  transactionDate: string;
  requestId: string;
  orderInfo: string;
  ipAddress: string | undefined;
  createdAt: Date;
}

export interface VnPayRefundInput extends VnPayTransactionOperationInput {
  createdBy: string;
}

export interface VnPayGatewayOperationResult {
  isVerified: boolean;
  isSuccess: boolean;
  responseCode: string | null;
  transactionStatus: string | null;
  transactionId: string | null;
  transactionType: string | null;
  amount: string | null;
  responseId: string | null;
  message: string;
}

interface VerifiedVnPayCallback {
  isValid: boolean;
  parameters: Record<string, string>;
}

interface VnPayConfiguration {
  paymentUrl: string;
  returnUrl: string;
  tmnCode: string;
  hashSecret: string;
}

export type VnPayBankCode = 'VNPAYQR' | 'VNBANK' | 'INTCARD';

const VIETNAM_UTC_OFFSET_MILLISECONDS = 7 * 60 * 60 * 1000;
const VNPAY_TRANSACTION_ENDPOINT = '/merchant_webapi/api/transaction';

@Injectable()
export class VnPayGatewayService {
  constructor(private readonly configService: ConfigService) {}

  isEnabled(): boolean {
    return this.configService.get<boolean>('VNPAY_ENABLED') === true;
  }

  createPaymentUrl(input: CreateVnPayUrlInput): string {
    const configuration = this.getConfiguration();
    const client = createVnPayClient(configuration);

    return client.buildPaymentUrl({
      vnp_Amount: toVnPayBaseAmount(input.amount),
      vnp_CreateDate: Number(formatVnPayDate(input.createdAt)),
      vnp_ExpireDate: Number(formatVnPayDate(input.expiresAt)),
      vnp_IpAddr: normalizeIpAddress(input.ipAddress),
      vnp_Locale: input.locale === 'en' ? VnpLocale.EN : VnpLocale.VN,
      vnp_OrderInfo: input.orderInfo,
      vnp_ReturnUrl: configuration.returnUrl,
      vnp_TxnRef: input.transactionReference,
      ...(input.bankCode === undefined ? {} : { vnp_BankCode: input.bankCode }),
    });
  }

  verifyCallback(query: Record<string, unknown>): VerifiedVnPayCallback {
    const configuration = this.getConfiguration();
    const parameters: Record<string, string> = {};
    let receivedSignature: string | undefined;

    for (const [key, value] of Object.entries(query)) {
      if (!key.startsWith('vnp_') || typeof value !== 'string') {
        continue;
      }

      if (key === 'vnp_SecureHash') {
        receivedSignature = value.toLowerCase();
      } else if (key !== 'vnp_SecureHashType' && value.length > 0) {
        parameters[key] = value;
      }
    }

    if (
      receivedSignature === undefined ||
      !/^[0-9a-f]{128}$/.test(receivedSignature)
    ) {
      return { isValid: false, parameters };
    }

    try {
      const result = createVnPayClient(configuration).verifyReturnUrl({
        ...parameters,
        vnp_SecureHash: receivedSignature,
      } as ReturnQueryFromVNPay);

      return { isValid: result.isVerified, parameters };
    } catch {
      return { isValid: false, parameters };
    }
  }

  async refundFull(
    input: VnPayRefundInput,
  ): Promise<VnPayGatewayOperationResult> {
    const configuration = this.getConfiguration();
    const body: Record<string, string | number> = {
      vnp_Amount: toVnPayBaseAmount(input.amount) * 100,
      vnp_Command: 'refund',
      vnp_CreateBy: input.createdBy,
      vnp_CreateDate: Number(formatVnPayDate(input.createdAt)),
      vnp_IpAddr: normalizeIpAddress(input.ipAddress),
      vnp_OrderInfo: input.orderInfo,
      vnp_RequestId: input.requestId,
      vnp_TransactionDate: requireVnPayDate(input.transactionDate),
      vnp_TransactionNo: requireVnPayTransactionNumber(input.transactionId),
      vnp_TransactionType: RefundTransactionType.FULL_REFUND,
      vnp_TxnRef: input.transactionReference,
      vnp_TmnCode: configuration.tmnCode,
      vnp_Version: '2.1.0',
    };
    const signData = [
      body.vnp_RequestId,
      body.vnp_Version,
      body.vnp_Command,
      body.vnp_TmnCode,
      body.vnp_TransactionType,
      body.vnp_TxnRef,
      body.vnp_Amount,
      body.vnp_TransactionNo,
      body.vnp_TransactionDate,
      body.vnp_CreateBy,
      body.vnp_CreateDate,
      body.vnp_IpAddr,
      body.vnp_OrderInfo,
    ]
      .map(String)
      .join('|');
    body.vnp_SecureHash = createPipeSignature(
      signData,
      configuration.hashSecret,
    );
    const endpoint = new URL(
      VNPAY_TRANSACTION_ENDPOINT,
      configuration.paymentUrl,
    );
    const httpResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!httpResponse.ok) {
      throw new Error(`VNPay refund HTTP error: ${httpResponse.status}`);
    }

    return normalizeRawRefundResponse(
      await httpResponse.json(),
      configuration.hashSecret,
    );
  }

  async queryTransaction(
    input: VnPayTransactionOperationInput,
  ): Promise<VnPayGatewayOperationResult> {
    const response = await createVnPayClient(this.getConfiguration()).queryDr({
      vnp_CreateDate: Number(formatVnPayDate(input.createdAt)),
      vnp_IpAddr: normalizeIpAddress(input.ipAddress),
      vnp_OrderInfo: input.orderInfo,
      vnp_RequestId: input.requestId,
      vnp_TransactionDate: requireVnPayDate(input.transactionDate),
      vnp_TransactionNo: requireVnPayTransactionNumber(input.transactionId),
      vnp_TxnRef: input.transactionReference,
    });

    return normalizeOperationResponse(response);
  }

  getTmnCode(): string {
    return this.getConfiguration().tmnCode;
  }

  private getConfiguration(): VnPayConfiguration {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException(
        'VNPay chua duoc cau hinh tren he thong.',
      );
    }

    return {
      paymentUrl: this.configService.getOrThrow<string>('VNPAY_PAYMENT_URL'),
      returnUrl: this.configService.getOrThrow<string>('VNPAY_RETURN_URL'),
      tmnCode: this.configService.getOrThrow<string>('VNPAY_TMN_CODE'),
      hashSecret: this.configService.getOrThrow<string>('VNPAY_HASH_SECRET'),
    };
  }
}

export function createVnPayQuery(parameters: Record<string, string>): string {
  return buildPaymentUrlSearchParams(parameters).toString();
}

export function createVnPaySignature(
  parameters: Record<string, string>,
  hashSecret: string,
): string {
  return calculateSecureHash({
    secureSecret: hashSecret,
    data: createVnPayQuery(parameters),
    hashAlgorithm: HashAlgorithm.SHA512,
    bufferEncode: 'utf8',
  });
}

export function formatVnPayDate(value: Date): string {
  const vietnamTime = new Date(
    value.getTime() + VIETNAM_UTC_OFFSET_MILLISECONDS,
  );

  return vietnamTime.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

export function parseVnPayDate(value: string | undefined): Date | null {
  if (value === undefined || !/^\d{14}$/.test(value)) {
    return null;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const hour = Number(value.slice(8, 10));
  const minute = Number(value.slice(10, 12));
  const second = Number(value.slice(12, 14));
  const timestamp =
    Date.UTC(year, month - 1, day, hour, minute, second) -
    VIETNAM_UTC_OFFSET_MILLISECONDS;
  const parsed = new Date(timestamp);

  if (formatVnPayDate(parsed) !== value || Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function createVnPayClient(configuration: VnPayConfiguration): VNPay {
  const paymentUrl = new URL(configuration.paymentUrl);
  const paymentEndpoint = paymentUrl.pathname.replace(/^\/+/, '');

  return new VNPay({
    vnpayHost: paymentUrl.origin,
    queryDrAndRefundHost: paymentUrl.origin,
    tmnCode: configuration.tmnCode,
    secureSecret: configuration.hashSecret,
    testMode: false,
    hashAlgorithm: HashAlgorithm.SHA512,
    enableLog: false,
    vnp_OrderType: ProductCode.Other,
    endpoints: paymentEndpoint.length === 0 ? {} : { paymentEndpoint },
  });
}

function requireVnPayDate(value: string): number {
  if (!/^\d{14}$/.test(value)) {
    throw new Error('VNPay transaction date is invalid.');
  }

  return Number(value);
}

function requireVnPayTransactionNumber(value: string): number {
  if (!/^[0-9]{1,15}$/.test(value)) {
    throw new Error('VNPay transaction number is invalid.');
  }

  const transactionNumber = Number(value);

  if (!Number.isSafeInteger(transactionNumber)) {
    throw new Error('VNPay transaction number exceeds the supported range.');
  }

  return transactionNumber;
}

function normalizeOperationResponse(
  response: QueryDrResponse,
): VnPayGatewayOperationResult {
  return {
    isVerified: response.isVerified,
    isSuccess: response.isSuccess,
    responseCode: optionalString(response.vnp_ResponseCode),
    transactionStatus: optionalString(response.vnp_TransactionStatus),
    transactionId: optionalString(response.vnp_TransactionNo),
    transactionType: optionalString(response.vnp_TransactionType),
    amount: optionalString(response.vnp_Amount),
    responseId:
      'vnp_ResponseId' in response
        ? optionalString(response.vnp_ResponseId)
        : null,
    message: response.message,
  };
}

function normalizeRawRefundResponse(
  value: unknown,
  hashSecret: string,
): VnPayGatewayOperationResult {
  if (!isRecord(value)) {
    throw new Error('VNPay refund response is invalid.');
  }

  const receivedHash = optionalString(value.vnp_SecureHash);
  const signData = [
    value.vnp_ResponseId,
    value.vnp_Command,
    value.vnp_ResponseCode,
    value.vnp_Message,
    value.vnp_TmnCode,
    value.vnp_TxnRef,
    value.vnp_Amount,
    value.vnp_BankCode,
    value.vnp_PayDate,
    value.vnp_TransactionNo,
    value.vnp_TransactionType,
    value.vnp_TransactionStatus,
    value.vnp_OrderInfo,
  ]
    .map((item) => optionalString(item) ?? '')
    .join('|')
    .replace(/undefined/g, '');
  const responseCode = optionalString(value.vnp_ResponseCode);

  return {
    isVerified:
      receivedHash !== null &&
      createPipeSignature(signData, hashSecret) === receivedHash,
    isSuccess: responseCode === '00',
    responseCode,
    transactionStatus: optionalString(value.vnp_TransactionStatus),
    transactionId: optionalString(value.vnp_TransactionNo),
    transactionType: optionalString(value.vnp_TransactionType),
    amount: optionalString(value.vnp_Amount),
    responseId: optionalString(value.vnp_ResponseId),
    message:
      optionalString(value.vnp_Message) ?? 'VNPay refund response received.',
  };
}

function createPipeSignature(data: string, hashSecret: string): string {
  return calculateSecureHash({
    secureSecret: hashSecret,
    data,
    hashAlgorithm: HashAlgorithm.SHA512,
    bufferEncode: 'utf8',
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function optionalString(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }

  return null;
}

function toVnPayBaseAmount(amount: string): number {
  const match = /^([0-9]+)[.]([0-9]{2})$/.exec(amount);

  if (match === null) {
    throw new Error('Payment amount is invalid.');
  }

  if (match[2] !== '00') {
    throw new Error('VNPay only supports whole VND amounts.');
  }

  const amountInVnd = BigInt(match[1]);

  if (amountInVnd > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Payment amount exceeds the supported range.');
  }

  return Number(amountInVnd);
}

function normalizeIpAddress(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    return '127.0.0.1';
  }

  if (value === '::1') {
    return '127.0.0.1';
  }

  const normalized = value.startsWith('::ffff:') ? value.slice(7) : value;

  return normalized.slice(0, 45);
}
