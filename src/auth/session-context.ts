export type SessionContext = {
  userId: number;
  email?: string;
  authority?: string;
  companyId?: number;
};

export type JwtPayload = {
  id: number;
  email?: string;
  authority?: string;
  companyId?: number;
};
