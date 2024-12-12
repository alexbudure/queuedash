import { DotsVerticalIcon } from "@radix-ui/react-icons";
import {
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
} from "react-aria-components";

type Action = {
  label: string;
  onSelect: () => void;
  icon: React.ReactNode;
};
type ActionMenuProps = {
  actions: Action[];
  // ariaLabel: todo: add aria-label
};
export const ActionMenu = ({ actions }: ActionMenuProps) => {
  return (
    <MenuTrigger>
      <Button
        className="flex size-7 items-center justify-center rounded-md bg-slate-50 text-slate-900 outline-none transition duration-150 ease-in-out hover:bg-slate-100 focus:bg-slate-100 radix-state-open:bg-slate-100"
        aria-label="Action menu"
      >
        <DotsVerticalIcon width={18} height={18} />
      </Button>

      <Popover
        placement="bottom left"
        className="space-y-0.5 rounded-md border border-slate-50 bg-white/75 p-1 shadow-sm backdrop-blur-md "
        offset={5}
      >
        <Menu>
          {actions.map((action) => {
            return (
              <MenuItem
                className="flex cursor-default items-center space-x-1.5 rounded-md py-1.5 pl-1.5 pr-8 text-sm font-medium text-slate-900 outline-none transition duration-150 ease-in-out focus:bg-slate-100"
                key={action.label}
                onAction={action.onSelect}
              >
                {action.icon}
                <span>{action.label}</span>
              </MenuItem>
            );
          })}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
};
