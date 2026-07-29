import { NextResponse } from "next/server";
import { getAllOrdersAllFulfillmentTypes } from "../../../lib/walmartClient";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const account = searchParams.get("account") || "kyle";
    const start = searchParams.get("start");
    const end = searchParams.get("end");

    const orders = await getAllOrdersAllFulfillmentTypes(account, {
      createdStartDate: `${start}T00:00:00.000Z`,
      createdEndDate: `${end}T23:59:59.999Z`,
    });

    const statusCounts = {};
    const statusRevenue = {};
    let totalOrders = orders.length;

    for (const order of orders) {
      const lines = order?.orderLines?.orderLine || [];
      for (const line of lines) {
        const statuses = line?.orderLineStatuses?.orderLineStatus || [];
        for (const s of statuses) {
          const status = s?.status || "(unknown)";
          const qty = Number(s?.statusQuantity?.amount || 0);
          const charges = line?.charges?.charge || [];
          let lineRevenue = 0;
          for (const c of charges) {
            if (c?.chargeType === "PRODUCT") lineRevenue += Number(c?.chargeAmount?.amount || 0);
          }
          statusCounts[status] = (statusCounts[status] || 0) + 1;
          statusRevenue[status] = (statusRevenue[status] || 0) + lineRevenue;
        }
      }
    }

    return NextResponse.json({
      account,
      totalOrders,
      statusCounts,
      statusRevenue,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message, stack: err.stack }, { status: 500 });
  }
}
