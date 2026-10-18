export type BoardTicket = {
  purpose: "board";
  boardId: string;
  userId: string;
  expiresAt: number;
};
export type UserTicket = { purpose: "user"; userId: string; expiresAt: number };
export type BoardEvent = {
  purpose: "event";
  boardId: string;
  eventId: string;
  taskId?: string;
  userIds?: string[];
  notifyBoard?: boolean;
  expiresAt: number;
};
export type NavigationEvent = {
  purpose: "event";
  kind: "navigation";
  eventId: string;
  userIds: string[];
  expiresAt: number;
};
export function signRealtimeToken(
  payload: BoardTicket | UserTicket | BoardEvent | NavigationEvent,
  secret: string,
): string;
export function verifyRealtimeToken(
  token: unknown,
  secret: string,
  purpose: "board",
  now?: number,
): BoardTicket;
export function verifyRealtimeToken(
  token: unknown,
  secret: string,
  purpose: "event",
  now?: number,
): BoardEvent | NavigationEvent;

export function verifyRealtimeToken(
  token: unknown,
  secret: string,
  purpose: "user",
  now?: number,
): UserTicket;
