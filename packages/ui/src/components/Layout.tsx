import type { FC, PropsWithChildren } from "react";
import type { RouterOutput } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { NavLink } from "react-router-dom";
import { Skeleton } from "./Skeleton";
import * as Toast from "@radix-ui/react-toast";
import {
  GitHubLogoIcon,
  LightningBoltIcon,
  ShadowNoneIcon,
} from "@radix-ui/react-icons";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { ErrorCard } from "./ErrorCard";

type QueueNavLinkProps = {
  queue: RouterOutput["queue"]["list"]["0"];
};
const QueueNavLink = ({ queue }: QueueNavLinkProps) => {
  return (
    <NavLink
      to={`../${queue.name}`}
      className={({ isActive }) =>
        `relative -ml-px flex w-full items-center space-x-3 border-l pl-4 text-slate-500 transition duration-150 ease-in-out dark:text-slate-400 ${
          isActive
            ? "border-brand-500 font-medium text-brand-500 dark:border-brand-300 dark:text-brand-300"
            : "border-slate-100 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:hover:border-slate-600 dark:hover:text-slate-100"
        }`
      }
    >
      <span className="truncate">{queue.displayName}</span>
    </NavLink>
  );
};

export const Layout: FC<PropsWithChildren> = ({ children }) => {
  const { data, isLoading, isError } = trpc.queue.list.useQuery();

  return (
    <Toast.Provider swipeDirection="right" duration={Infinity}>
      <div className="grid xl:grid-cols-[auto,1fr]">
        <div className="hidden xl:block">
          <div className="sticky top-0 flex h-full max-h-screen min-h-screen flex-col justify-between border-r border-slate-200 bg-slate-50/50 px-4 pt-8 pb-4 shadow-sm dark:border-slate-700 dark:bg-black">
            <div className="space-y-8">
              <div className="flex items-center space-x-2 text-brand-900 dark:text-brand-50">
                <ShadowNoneIcon width={28} height={28} />
                <p className="text-lg font-semibold">QueueDash</p>
              </div>

              <div className="w-full space-y-2 border-l border-slate-100 dark:border-slate-700">
                {isLoading ? (
                  [...new Array(10)].map((_, i) => {
                    return <Skeleton className="h-6" key={i} />;
                  })
                ) : isError ? (
                  <ErrorCard message="Could not fetch queues" />
                ) : (
                  data?.map((queue) => {
                    return <QueueNavLink key={queue.name} queue={queue} />;
                  })
                )}
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <a
                href="https://github.com/alexbudure/queuedash"
                target="_blank"
                rel="noreferrer"
                className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 text-slate-900 shadow-sm transition duration-150 ease-in-out hover:bg-slate-200 active:bg-slate-300 dark:bg-slate-600 dark:text-slate-50 dark:hover:bg-slate-500"
              >
                <GitHubLogoIcon />
              </a>
              <a
                href="https://github.com/alexbudure/queuedash"
                target="_blank"
                rel="noreferrer"
                className="flex h-7 items-center justify-center space-x-1.5 whitespace-nowrap rounded-md bg-amber-100 pl-2 pr-3 text-amber-900 shadow-sm transition duration-150 ease-in-out hover:bg-amber-200 active:bg-amber-300 dark:bg-amber-900 dark:text-amber-50"
              >
                <LightningBoltIcon />
                <span className="text-sm font-medium">Discover Pro</span>
              </a>
              <ThemeSwitcher />
            </div>
          </div>
        </div>

        <div className="bg-white px-4 py-3 dark:bg-[#121212] lg:px-10 lg:py-8">
          <div className="max-w-[1280px]">{children}</div>
        </div>
      </div>
      <Toast.Viewport className="fixed bottom-0 right-0 z-[2147483647] m-0 flex max-w-[100vw] list-none flex-col gap-2 p-6 outline-none" />
    </Toast.Provider>
  );
};
