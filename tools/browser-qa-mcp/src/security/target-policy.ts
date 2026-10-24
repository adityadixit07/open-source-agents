export interface TargetPolicyOptions {
  /** Exact origins (scheme + host + port) permitted, e.g. "http://127.0.0.1:4000". */
  allowedOrigins?: string[];
  /** Explicit opt-in required to test loopback/private-network destinations. */
  allowLocalDev?: boolean;
}

export interface TargetPolicyResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Minimal navigation/target gate: deny by default, and require an explicit
 * opt-in before any loopback or private-network address can be reached.
 *
 * Known limitation (documented in README): this checks the hostname/IP
 * literal in the URL only. It does not resolve DNS or revalidate redirect
 * targets, so it does not yet defend against DNS rebinding or a redirect
 * chain that lands on a disallowed address after this check runs.
 */
export class TargetPolicy {
  constructor(private readonly options: TargetPolicyOptions) {}

  evaluate(rawUrl: string): TargetPolicyResult {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return { allowed: false, reason: `Invalid URL: "${rawUrl}"` };
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { allowed: false, reason: `Unsupported protocol "${parsed.protocol}"; only http/https are permitted` };
    }

    if (isLoopbackOrPrivateHost(parsed.hostname) && !this.options.allowLocalDev) {
      return {
        allowed: false,
        reason: `Target host "${parsed.hostname}" is a loopback/private-network address; set allowLocalDev to permit local testing`,
      };
    }

    if (this.options.allowedOrigins && this.options.allowedOrigins.length > 0) {
      if (!this.options.allowedOrigins.includes(parsed.origin)) {
        return { allowed: false, reason: `Origin "${parsed.origin}" is not in the allowed origin list` };
      }
    }

    return { allowed: true };
  }
}

function isLoopbackOrPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "::1") return true;

  if (isIPv4(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local, includes cloud metadata (169.254.169.254)
  }

  return false;
}

function isIPv4(host: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}
