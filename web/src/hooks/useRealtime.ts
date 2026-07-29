import { useEffect, useState } from "react";

import type { RealtimeEvent } from "../api/types";

type ConnectionState = "idle" | "connecting" | "connected" | "reconnecting";

export function useRealtime(
  campaignId: string | undefined,
  lastSequence: number,
  joinCode: string | undefined,
  onEvent: (event: RealtimeEvent) => void,
): ConnectionState {
  const [state, setState] = useState<ConnectionState>("idle");

  useEffect(() => {
    if (!campaignId) return;
    let socket: WebSocket | null = null;
    let retryTimer: number | null = null;
    let closed = false;
    let delay = 1_000;

    const connect = () => {
      setState(delay === 1_000 ? "connecting" : "reconnecting");
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const params = new URLSearchParams({
        campaign_id: campaignId,
        last_sequence: String(lastSequence),
      });
      if (joinCode) params.set("join_code", joinCode);
      socket = new WebSocket(
        `${protocol}://${window.location.host}/api/v1/realtime?${params.toString()}`,
      );
      socket.onopen = () => {
        delay = 1_000;
        setState("connected");
      };
      socket.onmessage = (message) => {
        const value = JSON.parse(String(message.data)) as RealtimeEvent | { type: string };
        if ("event_id" in value) onEvent(value);
      };
      socket.onclose = () => {
        if (closed) return;
        setState("reconnecting");
        retryTimer = window.setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30_000);
      };
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [campaignId, joinCode, lastSequence, onEvent]);

  return state;
}
