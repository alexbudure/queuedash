import { Monitor, Moon, Sun } from "lucide-react";
import { ToggleButton, ToggleButtonGroup } from "react-aria-components";

import { useQueuedash } from "./QueuedashProvider";

export const ThemeSwitcher = () => {
  const { preferences, setTheme } = useQueuedash();

  return (
    <ToggleButtonGroup
      className="flex gap-0.5 rounded-lg bg-gray-100/80 p-1 dark:bg-slate-800/60"
      defaultSelectedKeys={["system"]}
      aria-label="Theme"
      selectedKeys={[preferences.theme]}
      onSelectionChange={(value) => {
        const nextTheme = value.has("system")
          ? "system"
          : value.has("light")
            ? "light"
            : value.has("dark")
              ? "dark"
              : preferences.theme;

        setTheme(nextTheme);
      }}
    >
      {[
        {
          value: "system",
          icon: () => <Monitor className="size-3" />,
          ariaLabel: "System theme",
        },
        {
          value: "light",
          icon: () => <Sun className="size-3" />,
          ariaLabel: "Light theme",
        },
        {
          value: "dark",
          icon: () => <Moon className="size-3" />,
          ariaLabel: "Dark theme",
        },
      ].map((item) => {
        return (
          <ToggleButton
            key={item.value}
            className="flex size-6 items-center justify-center rounded-md text-gray-400 transition-all duration-150 hover:text-gray-600 data-[selected=true]:bg-white data-[selected=true]:text-gray-900 data-[selected=true]:shadow-sm dark:text-slate-500 dark:hover:text-slate-400 dark:data-[selected=true]:bg-slate-700 dark:data-[selected=true]:text-slate-200 dark:data-[selected=true]:shadow-none"
            id={item.value}
            aria-label={item.ariaLabel}
          >
            {item.icon()}
          </ToggleButton>
        );
      })}
    </ToggleButtonGroup>
  );
};
