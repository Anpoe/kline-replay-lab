import { Brush, Gauge, LineChart, Square, Tag, Target, TrendingDown, TrendingUp } from "lucide-react";
export type DrawingTool = {
  name: string;
  label: string;
  icon: typeof LineChart;
  kind?: "rectangle" | "position" | "text";
};

export const drawingToolGroups: Array<{
  id: string;
  label: string;
  icon: typeof LineChart;
  tools: DrawingTool[];
}> = [
  {
    id: "lines",
    label: "趋势线工具",
    icon: TrendingUp,
    tools: [
      { name: "segment", label: "趋势线", icon: TrendingDown },
      { name: "rayLine", label: "射线", icon: TrendingUp },
      { name: "horizontalStraightLine", label: "水平线", icon: LineChart },
    ],
  },
  {
    id: "channels",
    label: "通道工具",
    icon: Gauge,
    tools: [
      { name: "parallelStraightLine", label: "二线平行通道", icon: Gauge },
      { name: "priceChannelLine", label: "三线价格通道", icon: Gauge },
    ],
  },
  {
    id: "fibonacci",
    label: "斐波那契工具",
    icon: Target,
    tools: [{ name: "fibonacciLine", label: "斐波那契回撤", icon: Target }],
  },
  {
    id: "shapes",
    label: "几何图形",
    icon: Square,
    tools: [{ name: "trainingRectangle", label: "矩形区域", icon: Square, kind: "rectangle" }],
  },
  {
    id: "notes",
    label: "画笔",
    icon: Brush,
    tools: [{ name: "brush", label: "画笔", icon: Brush }],
  },
  {
    id: "text",
    label: "文字标记",
    icon: Tag,
    tools: [{ name: "trainingTextBox", label: "文字标记", icon: Tag, kind: "text" }],
  },
];

export const trainingPositionTool: DrawingTool = { name: "trainingPosition", label: "多空仓位", icon: TrendingUp, kind: "position" };
export const allDrawingTools = [...drawingToolGroups.flatMap((group) => group.tools), trainingPositionTool];
export const defaultDrawingTools = Object.fromEntries(drawingToolGroups.map((group) => [group.id, group.tools[0].name]));

export function drawingLabel(name: string) {
  if (name === "trainingLongPosition") return "多头仓位（旧）";
  if (name === "trainingShortPosition") return "空头仓位（旧）";
  if (name === "trainingTextNote") return "文字标记（旧）";
  if (name === "trainingTextBox") return "文字标记";
  return allDrawingTools.find((tool) => tool.name === name)?.label ?? name;
}
