import { useRef, useState, type ChangeEvent, type RefObject } from "react";

import type { Campaign } from "../../api/types";
import { useToast } from "../../hooks/useToast";
import { Popover } from "../ui/Popover";

export function CampaignPopover({
  anchorRef,
  open,
  onClose,
  campaigns,
  campaignId,
  pending,
  onSelect,
  spectatorCode,
  spectatorsOnline,
  importPending,
  onImport,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  campaigns: Campaign[];
  campaignId: string;
  pending: boolean;
  onSelect: (campaignId: string) => void;
  spectatorCode?: string;
  spectatorsOnline: boolean;
  importPending: boolean;
  onImport: (file: File) => void;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const choosePack = () => fileInput.current?.click();
  const importPack = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onImport(file);
  };

  const copyCode = () => {
    if (!spectatorCode) return;
    navigator.clipboard.writeText(spectatorCode).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2_000);
      },
      () =>
        toast.push({
          tone: "error",
          title: "Не удалось скопировать",
          description: "Браузер не дал доступ к буферу обмена — скопируйте код вручную.",
        }),
    );
  };

  return (
    <Popover anchorRef={anchorRef} open={open} onClose={onClose} label="Кампания">
      <p className="popover__title">Кампания</p>
      <ul className="popover__list">
        {campaigns.map((campaign) => (
          <li key={campaign.id}>
            <button
              type="button"
              className={`popover__row${campaign.id === campaignId ? " is-selected" : ""}`}
              disabled={pending}
              aria-current={campaign.id === campaignId}
              onClick={() => {
                if (campaign.id !== campaignId) onSelect(campaign.id);
                onClose();
              }}
            >
              <span className="popover__row-mark" aria-hidden="true" />
              <span className="popover__row-name">{campaign.name}</span>
            </button>
          </li>
        ))}
      </ul>

      <input
        ref={fileInput}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={importPack}
      />
      <button type="button" className="mini-button" disabled={importPending} onClick={choosePack}>
        {importPending ? "Проверяем пакет…" : "Импортировать ZIP"}
      </button>

      <hr className="popover__rule" />

      <p className="popover__title">Зрительский экран</p>
      <div className="popover__code">
        <strong>{spectatorCode ?? "—"}</strong>
        <button
          type="button"
          className="mini-button"
          disabled={!spectatorCode}
          onClick={copyCode}
        >
          {copied ? "Скопировано" : "Копировать"}
        </button>
      </div>
      <p className={`popover__status${spectatorsOnline ? " is-online" : ""}`}>
        <span aria-hidden="true" />
        {spectatorsOnline ? "Соединение активно" : "Зрителей нет"}
      </p>
    </Popover>
  );
}
