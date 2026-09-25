import type TradebookPlugin from "../main";
import type { GridItem } from "../lib/grid";
import { HOME_DEFAULT, WidgetGridView, type DashItem } from "./dashboard";

export const HOME_VIEW_TYPE = "tradebook-home-view";

/**
 * Home = the journal talking to you. It reuses the
 * shared WidgetGridView engine and owns its own persisted layout
 * (`settings.homeLayout`), seeded from HOME_DEFAULT.
 *
 * The difference from Dashboard (displayed as "Analytics") is the DEFAULT, not
 * the allow-list: both views accept any widget, so the trader can add whatever
 * they want to either.
 */
export class HomeView extends WidgetGridView {
  constructor(leaf: any, plugin: TradebookPlugin) {
    super(leaf, plugin);
  }

  getViewType(): string {
    return HOME_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Home";
  }

  getIcon(): string {
    return "home";
  }

  layout(): DashItem[] | undefined {
    return this.plugin.settings.homeLayout;
  }

  setLayout(layout: DashItem[]): void {
    this.plugin.settings.homeLayout = layout;
  }

  defaultLayout(): GridItem[] {
    return HOME_DEFAULT;
  }

  viewKey(): string {
    return "home";
  }
}
