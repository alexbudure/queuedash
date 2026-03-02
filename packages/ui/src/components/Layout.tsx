import {
  type FC,
  type PropsWithChildren,
  type ReactNode,
  useState,
} from "react";
import { clsx } from "clsx";
import { trpc } from "../utils/trpc";
import { NavLink } from "react-router";
import { Skeleton } from "./Skeleton";
import { Github, Layers, Menu } from "lucide-react";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { ErrorCard } from "./ErrorCard";
import { SidePanelDialog } from "./SidePanelDialog";

type QueueNavLinkProps = {
  to: string;
  label: string;
  onClick?: () => void;
};
const QueueNavLink = ({ to, label, onClick }: QueueNavLinkProps) => {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        clsx(
          "flex w-full items-center rounded-md py-1.5 text-sm transition-all duration-150",
          {
            "font-semibold text-gray-900 dark:text-white": isActive,
            "font-medium text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300":
              !isActive,
          },
        )
      }
    >
      <span className="truncate">{label}</span>
    </NavLink>
  );
};

const SidebarContent = ({
  data,
  isLoading,
  isError,
  onNavClick,
  showHeader = true,
}: {
  data: { name: string; displayName: string }[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onNavClick?: () => void;
  showHeader?: boolean;
}) => (
  <div className="flex min-h-0 flex-1 flex-col">
    {showHeader && (
      <>
        <div className="pb-4 pt-3">
          <NavLink
            to="../"
            onClick={onNavClick}
            className="flex items-center gap-2 text-gray-900 dark:text-white"
          >
            <Layers className="size-5" strokeWidth={2.5} />
            <p className="text-base font-semibold tracking-tight">Queuedash</p>
          </NavLink>
        </div>

        <div className="border-t border-gray-200/80 dark:border-slate-800" />
      </>
    )}

    <div className="min-h-0 flex-1 overflow-y-auto py-4">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-600">
        Queues
      </div>
      <div className="space-y-0.5">
        {isLoading ? (
          [...new Array(10)].map((_, i) => {
            return <Skeleton className="h-8 w-full rounded-md" key={i} />;
          })
        ) : isError ? (
          <ErrorCard message="Could not fetch queues" />
        ) : (
          data?.map((queue) => {
            return (
              <QueueNavLink
                key={queue.name}
                to={`../${queue.name}`}
                label={queue.displayName}
                onClick={onNavClick}
              />
            );
          })
        )}
      </div>
    </div>

    <div className="shrink-0 border-t border-gray-200/80 pt-3 dark:border-slate-800">
      <div className="flex w-full items-center justify-between">
        <a
          href="https://github.com/alexbudure/queuedash"
          target="_blank"
          rel="noreferrer"
          className="flex size-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:text-gray-900 dark:text-slate-600 dark:hover:text-white"
        >
          <Github size={15} />
        </a>

        <ThemeSwitcher />
      </div>
    </div>
  </div>
);

const MobileNav = ({
  data,
  isLoading,
  isError,
}: {
  data: { name: string; displayName: string }[] | undefined;
  isLoading: boolean;
  isError: boolean;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-gray-100/60 bg-white/90 px-4 py-3 backdrop-blur-md dark:border-slate-800/60 dark:bg-slate-900/90 xl:hidden">
        <NavLink
          to="../"
          className="flex items-center gap-2.5 text-gray-900 dark:text-white"
        >
          <Layers className="size-5" strokeWidth={2.5} />
          <p className="text-base font-semibold tracking-tight">Queuedash</p>
        </NavLink>
        <button
          onClick={() => setOpen(true)}
          className="flex size-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:text-gray-900 dark:text-slate-500 dark:hover:text-white"
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </button>
      </div>

      {open && (
        <SidePanelDialog
          title="Queuedash"
          open={open}
          onOpenChange={setOpen}
          panelClassName="!max-w-[288px]"
        >
          <div className="flex h-full flex-col px-5 py-4">
            <SidebarContent
              data={data}
              isLoading={isLoading}
              isError={isError}
              onNavClick={() => setOpen(false)}
              showHeader={false}
            />
          </div>
        </SidePanelDialog>
      )}
    </>
  );
};

type LayoutProps = PropsWithChildren<{
  top?: ReactNode;
}>;

export const Layout: FC<LayoutProps> = ({ children, top }) => {
  const { data, isLoading, isError } = trpc.queue.list.useQuery();

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      <MobileNav data={data} isLoading={isLoading} isError={isError} />

      {/* Desktop sidebar */}
      <aside className="hidden w-72 shrink-0 xl:sticky xl:top-0 xl:block xl:h-screen">
        <div className="flex h-screen flex-col px-5 py-4">
          <SidebarContent data={data} isLoading={isLoading} isError={isError} />
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="mx-auto max-w-[1700px] pt-14 xl:py-3 xl:pr-4">
          {top ? <div className="mb-3 hidden px-1 xl:block">{top}</div> : null}
          <div className="min-h-[calc(100vh-3.5rem)] bg-white p-4 dark:bg-slate-900 xl:min-h-[calc(100vh-3.25rem)] xl:rounded-2xl xl:border xl:border-gray-100/60 xl:p-6 xl:shadow-[0_1px_3px_0_rgb(0_0_0/0.04)] xl:dark:border-slate-800/40 xl:dark:shadow-none">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};
