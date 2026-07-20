class RateLimiter {
  constructor(tokensPerSecond, bucketSize) {
    this.tokensPerSecond = tokensPerSecond;
    this.bucketSize = bucketSize;
    this.tokens = bucketSize;
    this.lastRefill = Date.now();
  }

  refill() {
    const now = Date.now();
    const timePassed = (now - this.lastRefill) / 1000;
    const tokensToAdd = timePassed * this.tokensPerSecond;
    
    this.tokens = Math.min(this.bucketSize, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  consume(tokensToConsume = 1) {
    this.refill();
    
    if (this.tokens >= tokensToConsume) {
      this.tokens -= tokensToConsume;
      return true;
    }
    
    return false;
  }
}

module.exports = RateLimiter;
