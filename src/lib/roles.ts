// The kinds of jobs the applicant usually targets. Each application is written
// with one of these as its focus.
export const ROLE_KEYS = ['management', 'automation', 'general_va', 'admin'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_LABELS: Record<RoleKey, string> = {
  management: 'Management',
  automation: 'Automation',
  general_va: 'General VA',
  admin: 'Admin',
};

// Per-role proof points pulled from the resume + portfolio. `_source` is a
// fingerprint of what they were generated from, so they refresh when the
// resume or portfolio changes; `_edited` means the user changed them by hand
// and they must not be overwritten automatically.
export type RoleHighlights = Partial<Record<RoleKey, string>> & {
  _source?: string;
  _edited?: boolean;
};
