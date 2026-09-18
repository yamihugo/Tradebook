import type TradebookPlugin from "../main";
import { DashboardView, DASHBOARD_VIEW_TYPE } from "./dashboard";

export const HOME_VIEW_TYPE = "tradebook-home-view";

/**
 * Home = Journalit's dashboard.
 * Copy their dashboard, put it in our home, and that becomes our dashboard.
 * Reuses DashboardView's widget grid; only the identity changes.
 */
export class HomeView extends DashboardView {
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
}
