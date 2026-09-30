// ListRow — one row of a ranked or triaged list: a leading mark, a title with a detail line, and a
// trailing figure or bar. With `href` the whole row is the link. <ListRows> stacks them; the row itself
// carries no border so a list can also sit inside a Panel.
import Link from "next/link";

export function ListRows({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <ol data-kit="list-rows" data-role="list-rows" className={`space-y-2 ${className}`}>
      {children}
    </ol>
  );
}

/** A hairline-framed, divided list: the frame for rows that each own their own layout. */
export function RowList({ children, radius = "2xl", className = "" }: { children: React.ReactNode; radius?: "xl" | "2xl"; className?: string }) {
  return (
    <ul
      data-kit="row-list"
      data-role="row-list"
      className={`divide-y divide-divider ${radius === "xl" ? "rounded-xl" : "rounded-2xl"} border border-divider ${className}`}
    >
      {children}
    </ul>
  );
}

/** An open ruled list: hairlines between rows and along the top and bottom edge, no side frame or radius. */
export function HairlineList({
  children,
  as: Tag = "ul",
  className = "",
  ...rest
}: {
  children: React.ReactNode;
  as?: "ul" | "ol" | "div";
  className?: string;
} & Omit<React.HTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <Tag data-kit="hairline-list" data-role="hairline-list" className={`divide-y divide-divider border-y border-divider ${className}`.trim()} {...rest}>
      {children}
    </Tag>
  );
}

const ROW = "focus-ring group grid grid-cols-1 items-center gap-x-4 gap-y-1.5 rounded-md py-1";

export function ListRow({
  href,
  onPress,
  selected,
  leading,
  leadingTitle,
  title,
  detail,
  trailing,
}: {
  href?: string;
  /** Makes the whole row a button (a row that opens a detail level in place). Ignored when `href` is set. A handler can only be passed from a client component. */
  onPress?: () => void;
  /** Marks the row as the open one (`aria-current`, `data-selected`). */
  selected?: boolean;
  leading?: React.ReactNode;
  /** Tooltip explaining the leading mark (e.g. what the rank means). */
  leadingTitle?: string;
  title: React.ReactNode;
  detail?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  const cols = trailing != null ? "sm:grid-cols-[minmax(0,1fr)_16rem]" : "";
  const body = (
    <>
      <span className="flex min-w-0 items-start gap-3">
        {leading != null && (
          <span
            data-role="list-row-mark"
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-accent/40 type-mono-sm text-accent"
            title={leadingTitle}
          >
            {leading}
          </span>
        )}
        <span className="min-w-0">
          <span data-role="list-row-title" className="block truncate font-medium text-white group-hover:text-accent">
            {title}
          </span>
          {detail != null && <span className="block type-body-sm text-slate-400">{detail}</span>}
        </span>
      </span>
      {trailing}
    </>
  );
  return (
    <li data-kit="list-row" data-role="list-row" data-selected={selected ? "" : undefined}>
      {href ? (
        <Link href={href} className={`${ROW} ${cols}`} aria-current={selected ? "true" : undefined}>
          {body}
        </Link>
      ) : onPress ? (
        <button type="button" onClick={onPress} aria-current={selected ? "true" : undefined} className={`${ROW} ${cols} w-full text-left`}>
          {body}
        </button>
      ) : (
        <div className={`${ROW} ${cols}`}>{body}</div>
      )}
    </li>
  );
}
