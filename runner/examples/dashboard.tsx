// 测试样例 1：recharts + shadcn/ui 销售仪表盘（react 类型）
import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RefreshCw, ShoppingCart, TrendingUp, Users } from "lucide-react";

const MONTHLY = [
  { month: "1月", 销售额: 4200, 订单: 240 },
  { month: "2月", 销售额: 3800, 订单: 221 },
  { month: "3月", 销售额: 5100, 订单: 290 },
  { month: "4月", 销售额: 4780, 订单: 265 },
  { month: "5月", 销售额: 5890, 订单: 320 },
  { month: "6月", 销售额: 6390, 订单: 356 },
];

const CHANNELS = [
  { name: "线上商城", value: 45 },
  { name: "小程序", value: 30 },
  { name: "线下门店", value: 15 },
  { name: "其它", value: 10 },
];

const COLORS = ["#D97757", "#4C8C6A", "#5B7DB1", "#C7B26A"];

function Stat({ icon: Icon, label, value, delta }: { icon: any; label: string; value: string; delta: string }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground">{delta}</p>
      </CardContent>
    </Card>
  );
}

export default function SalesDashboard() {
  const [refreshedAt, setRefreshedAt] = useState(() => new Date());
  const total = useMemo(() => MONTHLY.reduce((sum, m) => sum + m.销售额, 0), []);

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">销售仪表盘</h1>
            <p className="text-sm text-muted-foreground">
              上半年经营概览 · 更新于 {refreshedAt.toLocaleTimeString("zh-CN")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">演示数据</Badge>
            <Button size="sm" variant="outline" onClick={() => setRefreshedAt(new Date())}>
              <RefreshCw className="mr-1 h-4 w-4" /> 刷新
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Stat icon={TrendingUp} label="总销售额" value={`¥${(total / 10).toFixed(1)} 万`} delta="同比 +18.2%" />
          <Stat icon={ShoppingCart} label="总订单数" value="1,692" delta="同比 +9.6%" />
          <Stat icon={Users} label="新增客户" value="483" delta="同比 +23.1%" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>经营趋势</CardTitle>
            <CardDescription>按月查看销售额、订单量与渠道构成</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="sales">
              <TabsList>
                <TabsTrigger value="sales">销售额</TabsTrigger>
                <TabsTrigger value="orders">订单量</TabsTrigger>
                <TabsTrigger value="channels">渠道构成</TabsTrigger>
              </TabsList>
              <Separator className="my-4" />
              <TabsContent value="sales" className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={MONTHLY}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="销售额" fill="#D97757" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </TabsContent>
              <TabsContent value="orders" className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={MONTHLY}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="订单" stroke="#4C8C6A" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </TabsContent>
              <TabsContent value="channels" className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={CHANNELS} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} label>
                      {CHANNELS.map((entry, index) => (
                        <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Legend />
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
