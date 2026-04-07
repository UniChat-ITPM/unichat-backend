export const ModerationConfig = {
  otp: {
    maxAttemptsPerIp: 5,
    maxAttemptsPerPhone: 5,
    timeWindowMs: 60 * 60 * 1000, // 1 hour
  },
  spam: {
    thresholdScore: 80,
    blockedKeywords: [
      'free money',
      'click to win',
      'scam link',
      'winner',
      'lottery',
    ], // Placeholder simple rules
  },
  login: {
    maxFailedAttempts: 5,
    lockoutDurationMs: 15 * 60 * 1000, // 15 mins
  },
};
