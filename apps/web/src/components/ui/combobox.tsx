import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { CheckIcon, ChevronsUpDownIcon, SearchIcon } from "lucide-react";
import { cn } from "../../lib/utils.ts";

export interface ComboboxOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

export function Combobox({
  id,
  options,
  value,
  placeholder = "Seleccionar…",
  searchPlaceholder = "Buscar…",
  emptyText = "No hay resultados.",
  disabled = false,
  invalid = false,
  "aria-describedby": ariaDescribedBy,
  onValueChange,
}: {
  readonly id?: string;
  readonly options: readonly ComboboxOption[];
  readonly value: string;
  readonly placeholder?: string;
  readonly searchPlaceholder?: string;
  readonly emptyText?: string;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly "aria-describedby"?: string | undefined;
  readonly onValueChange: (value: string) => void;
}) {
  const selected = options.find((option) => option.value === value) ?? null;
  return (
    <ComboboxPrimitive.Root
      items={[...options]}
      value={selected}
      disabled={disabled}
      isItemEqualToValue={(left, right) => left.value === right.value}
      onValueChange={(option) => option && onValueChange(option.value)}
    >
      <ComboboxPrimitive.Trigger
        id={id}
        aria-invalid={invalid || undefined}
        aria-describedby={ariaDescribedBy}
        className="flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] data-placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ComboboxPrimitive.Value placeholder={placeholder} />
        <ChevronsUpDownIcon className="size-4 shrink-0 opacity-50" />
      </ComboboxPrimitive.Trigger>
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner align="start" sideOffset={4} className="z-50 outline-none">
          <ComboboxPrimitive.Popup
            aria-label={placeholder}
            className="w-[var(--anchor-width)] min-w-56 max-w-[var(--available-width)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
          >
            <div className="relative border-b">
              <SearchIcon className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <ComboboxPrimitive.Input
                autoFocus
                aria-label={searchPlaceholder}
                placeholder={searchPlaceholder}
                className="h-9 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <ComboboxPrimitive.Empty className="p-3 text-sm text-muted-foreground">
              {emptyText}
            </ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List className="max-h-[min(18rem,var(--available-height))] overflow-y-auto p-1 outline-none">
              {(option: ComboboxOption) => (
                <ComboboxPrimitive.Item
                  key={option.value}
                  value={option}
                  className={cn(
                    "relative grid cursor-default grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none",
                    "data-highlighted:bg-accent data-highlighted:text-accent-foreground",
                  )}
                >
                  <ComboboxPrimitive.ItemIndicator>
                    <CheckIcon className="size-4" />
                  </ComboboxPrimitive.ItemIndicator>
                  <span className="min-w-0">
                    <span className="block truncate">{option.label}</span>
                    {option.description ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                </ComboboxPrimitive.Item>
              )}
            </ComboboxPrimitive.List>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  );
}

export function filterComboboxOptions(
  options: readonly ComboboxOption[],
  query: string,
): ComboboxOption[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...options];
  return options.filter((option) =>
    `${option.label} ${option.description ?? ""}`.toLocaleLowerCase().includes(normalized),
  );
}
