export type MobileAccessStatus = {
  enabled: boolean;
  storageError: string;
  adminToken: string;
  firewallAvailable: boolean;
  tailscale?: TailscaleAccessStatus;
  challenge: { code: string; expiresAt: number } | null;
  addresses: { name: string; kind?: "direct"; address: string; url: string }[];
  pending: { id: string; name: string; number: string; expiresAt: number }[];
  devices: { id: string; name: string; createdAt: number; expiresAt: number; expired: boolean }[];
};

export type TailscaleAccessStatus = {
  state: string;
  enabled: boolean;
  url: string | null;
  consentUrl: string | null;
};
