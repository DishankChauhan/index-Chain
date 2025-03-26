import crypto from 'crypto';

/**
 * Validates the signature of a Helius webhook request by comparing the HMAC-SHA256
 * hash of the request body with the provided signature
 * @param body The webhook request body
 * @param signature The signature from x-signature header
 * @param secret The webhook secret used to sign the request
 * @returns boolean indicating if signature is valid
 */
export function validateWebhookSignature(
  body: unknown,
  signature: string,
  secret: string
): boolean {
  try {
    const payload = JSON.stringify(body);
    const hmac = crypto.createHmac('sha256', secret);
    const digest = hmac.update(payload).digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(digest)
    );
  } catch (error) {
    return false;
  }
}