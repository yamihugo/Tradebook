import type TradebookPlugin from "../main";
import type { GridItem } from "../lib/grid";
import { HOME_DEFAULT, HOME_IDS, WidgetGridView, type DashItem } from "./dashboard";

export const HOME_VIEW_TYPE = "tradebook-home-view";

/**
 * Home = the journal talking to you. A fixed narrative of eight blocks that fit
 * one screen, seeded from HOME_DEFAULT and curated to the same eight ids.
 *
 * It reuses the shared WidgetGridView engine (same grid, same widgets) but owns
 * its own persisted layout (`settings.homeLayout`) so it can never drift from
 * the Dashboard archive.
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

  allowedIds(): Set<string> {
    return new Set(HOME_IDS);
  }

  viewKey(): string {
    return "home";
  }
}
