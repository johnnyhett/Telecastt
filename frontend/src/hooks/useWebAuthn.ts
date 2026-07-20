import { useState, useCallback } from 'react';

export function useWebAuthn() {
  const [isSupported] = useState<boolean>(
    typeof window !== 'undefined' && !!window.navigator?.credentials?.get
  );

  const authenticate = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      console.warn("WebAuthn is not supported on this device.");
      return false;
    }

    try {
      // In production, the challenge comes from the server.
      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);

      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: challenge,
          timeout: 60000,
          userVerification: "preferred"
        }
      });

      if (credential) {
        return true;
      }
      return false;
    } catch (error) {
      console.error("WebAuthn authentication failed:", error);
      return false;
    }
  }, [isSupported]);

  return { authenticate, isSupported };
}
