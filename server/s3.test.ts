import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signV4 } from './s3';

const empty = createHash('sha256').update('').digest('hex');
const creds = { accessKey: 'AKIDEXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 'service', date: new Date('2015-08-30T12:36:00Z') };

describe('AWS Signature Version 4', () => {
  // From the AWS SigV4 test suite (get-vanilla and get-vanilla-query-order-key-case).
  it('signs get-vanilla like the reference', () => {
    const h = signV4({ method: 'GET', url: 'https://example.amazonaws.com/', payloadHash: empty, ...creds });
    expect(h.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
    expect(h['x-amz-date']).toBe('20150830T123600Z');
  });

  it('sorts query parameters like the reference', () => {
    const h = signV4({ method: 'GET', url: 'https://example.amazonaws.com/?Param2=value2&Param1=value1', payloadHash: empty, ...creds });
    expect(h.authorization).toMatch(/Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500$/);
  });
});
