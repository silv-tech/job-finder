// Detect job requirements that need human action (can't be automated)
const MANUAL_TRIGGERS = [
  { pattern: /loom/i, label: 'Loom video required' },
  { pattern: /video\s*(intro|introduction|presentation|recording|submission)/i, label: 'Video submission required' },
  { pattern: /record\s*(a|your)\s*video/i, label: 'Video recording required' },
  { pattern: /screen\s*recording/i, label: 'Screen recording required' },
  { pattern: /include\s*(a|your)\s*video/i, label: 'Video required' },
  { pattern: /send\s*(a|us|your)\s*video/i, label: 'Video required' },
  { pattern: /code\s*(test|challenge|assessment)/i, label: 'Code test required' },
  { pattern: /technical\s*(test|assessment|challenge|exam)/i, label: 'Technical assessment required' },
  { pattern: /take\s*home\s*(test|assignment|project)/i, label: 'Take-home assignment required' },
  { pattern: /trial\s*(task|project|period|assignment)/i, label: 'Trial task required' },
  { pattern: /paid\s*test/i, label: 'Paid test required' },
  { pattern: /portfolio\s*review\s*call/i, label: 'Portfolio review call required' },
  { pattern: /live\s*(interview|demo|coding|call)/i, label: 'Live session required' },
  { pattern: /zoom\s*(call|interview|meeting)/i, label: 'Zoom call required' },
  { pattern: /google\s*meet/i, label: 'Video call required' },
];

export function detectManualRequirements(description: string): { hasManual: boolean; requirements: string[] } {
  const requirements: string[] = [];

  for (const trigger of MANUAL_TRIGGERS) {
    if (trigger.pattern.test(description)) {
      if (!requirements.includes(trigger.label)) {
        requirements.push(trigger.label);
      }
    }
  }

  return { hasManual: requirements.length > 0, requirements };
}
