/**
 * Token bucket rate limiter with configurable jitter.
 * Enforces rate limits while allowing burst traffic up to capacity.
 */

/**
 * Token bucket implementation for rate limiting.
 * Tokens refill at a constant rate, allowing burst up to capacity.
 * Adds random jitter to wait times to prevent thundering herd.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillRate: number; // tokens per second
  private readonly jitterMinMs: number;
  private readonly jitterMaxMs: number;

  /**
   * Create a token bucket rate limiter.
   * @param capacity - Maximum tokens (burst capacity)
   * @param refillRate - Tokens added per second
   * @param jitterMinMs - Minimum jitter to add to waits
   * @param jitterMaxMs - Maximum jitter to add to waits
   */
  constructor(
    capacity = 5,
    refillRate = 1,
    jitterMinMs = 50,
    jitterMaxMs = 300
  ) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.jitterMinMs = jitterMinMs;
    this.jitterMaxMs = jitterMaxMs;
    this.tokens = capacity; // Start with full capacity
    this.lastRefill = Date.now();
  }

  /**
   * Refill tokens based on elapsed time.
   * Caps tokens at capacity to prevent accumulation.
   */
  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsedSeconds * this.refillRate;
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * Generate random jitter within configured range.
   */
  private jitter(): number {
    return (
      this.jitterMinMs +
      Math.random() * (this.jitterMaxMs - this.jitterMinMs)
    );
  }

  /**
   * Consume tokens from the bucket.
   * Waits if insufficient tokens are available.
   * Adds random jitter to all waits to prevent synchronization.
   * @param count - Number of tokens to consume
   */
  async consume(count = 1): Promise<void> {
    this.refill();

    if (this.tokens >= count) {
      this.tokens -= count;
      return;
    }

    // Not enough tokens - calculate wait time
    const tokensNeeded = count - this.tokens;
    const waitMs = (tokensNeeded / this.refillRate) * 1000;
    const totalWait = waitMs + this.jitter();

    await new Promise((resolve) => setTimeout(resolve, totalWait));

    // After waiting, refill and consume
    this.refill();
    this.tokens -= count;
  }

  /**
   * Get the current number of available tokens.
   * Automatically refills before returning.
   */
  get availableTokens(): number {
    this.refill();
    return this.tokens;
  }
}
