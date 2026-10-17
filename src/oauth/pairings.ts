// In-process `Map<jti, Pairing>` per spec.
// A pairing is the durable record of an approved agent (created in Phase 4 by
// login-exchange-handler; consumed by the Phase 6 GET/DELETE /api/agents endpoints).

export type Pairing = {
  jti: string;
  userId: number;
  clientId: string;
  userCode: string;
  approvedAt: string;
  deviceCode: string;
};

export type PairingsStore = {
  add: (pairing: Pairing) => void;
  get: (jti: string) => Pairing | undefined;
  listByUser: (userId: number) => Pairing[];
  remove: (jti: string) => boolean;
};

export function createPairingsStore(): PairingsStore {
  const map = new Map<string, Pairing>();

  return {
    add(pairing) {
      map.set(pairing.jti, pairing);
    },
    get(jti) {
      return map.get(jti);
    },
    listByUser(userId) {
      const out: Pairing[] = [];
      for (const p of map.values()) {
        if (p.userId === userId) {
          out.push(p);
        }
      }
      return out;
    },
    remove(jti) {
      return map.delete(jti);
    },
  };
}
