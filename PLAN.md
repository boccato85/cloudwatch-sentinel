# PLAN.md: Datadog-Inspired UI Enhancements (Node Heatmap)

## Objective
Implement Datadog-inspired visual enhancements to the Sentinel dashboard to provide deeper, at-a-glance insights into cluster health and resource utilization without sacrificing the "no-scroll" identity.

## Key Features

1.  **Node Honeycomb Heatmap (CPU & Memory)**
    *   Transform the static Node Health Map into a dynamic heatmap.
    *   Nodes will be colored based on their resource saturation (Requested vs. Allocatable).
    *   **Color Scale (Saturation):**
        *   `< 60%`: Green/Cyan (Healthy)
        *   `60% - 75%`: Yellow (Moderate)
        *   `76% - 85%`: Orange (High)
        *   `> 85%`: Red (Critical/Saturated)
    *   **Metric Toggle:** The user can visually see both CPU and Memory saturation. The primary color will represent the most saturated resource (or we can toggle between them). For simplicity and immediate impact, we will color the node based on the *maximum* saturation between CPU and Memory.
    *   **Tooltip:** Hovering over a node will show exact CPU and Memory usage percentages.

2.  **Top Consumers Progress Bars**
    *   Add subtle background progress bars (using CSS `linear-gradient`) to the "Top CPU Consumer" and "Top Memory Consumer" KPI cards to visually represent their relative impact.

3.  **Single-Node Mock Mode (for UI Validation)**
    *   If the API returns only 1 node (e.g., Minikube), the frontend will intercept and generate 24 "mock" nodes with varying, realistic CPU and Memory loads.
    *   This allows us to visualize the full heatmap experience immediately.
    *   A visual indicator (e.g., a small text tag) will denote that "Mock Data" is active.

## Implementation Steps

### Backend (Go API)
1.  **Expand `NodeInfo` Struct:** Add `CpuAllocatable`, `CpuRequested`, `MemAllocatable`, `MemRequested` fields to `agent/pkg/api/types.go`.
2.  **Populate Node Metrics:** Modify the metric collection loop in `agent/main.go` to calculate and attach these resource values to each node in the `ClusterSummary`.

### Frontend (JS/CSS)
1.  **Modify `dashboard.js` (Node Render):** Update the `honeycomb` rendering logic to calculate saturation percentages for CPU and Mem, determine the worst-case color, and apply the appropriate CSS class/inline style.
2.  **Implement Mock Generator:** Add logic in `renderOverview` to intercept `nodes.length === 1` and inject the 24 mock nodes.
3.  **Top Consumers Background:** Add logic in `updateCpuTile` and `updateMemTile` (or the KPI strip update functions) to apply the CSS gradient background.

## Rollout
*   Build image (`v0.11-heatmap`).
*   Deploy to Minikube.
*   Verify UI visually.
*   Commit changes.
