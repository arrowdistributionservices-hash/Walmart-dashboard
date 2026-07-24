import { NextResponse } from "next/server";
import { ACCOUNTS } from "../../../lib/accounts";
import { computeAccountData } from "../../../lib/computeAccountData";
import {
  buildSingleAccountCsv,
  buildAllAccountsCsv,
  buildSingleAccountXlsx,
  buildAllAccountsXlsx,
} from "../../../lib/exportData";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const accountParam = searchParams.get("account") || ACCOUNTS[0].id;
    const format = (searchParams.get("format") || "csv").toLowerCase();
    const today = new Date();
    const defaultStart = new Date(today);
    defaultStart.setDate(defaultStart.getDate() - 30);
    const startDate = searchParams.get("start") || defaultStart.toISOString().slice(0, 10);
    const endDate = searchParams.get("end") || today.toISOString().slice(0, 10);

    if (!["csv", "xlsx"].includes(format)) {
      return NextResponse.json({ error: 'format must be "csv" or "xlsx".' }, { status: 400 });
    }

    if (accountParam === "all") {
      const accountsData = await Promise.all(
        ACCOUNTS.map((acct) => computeAccountData(acct.id, { startDate, endDate }))
      );
      const filenameBase = `walmart-all-accounts_${startDate}_to_${endDate}`;

      if (format === "csv") {
        const csv = buildAllAccountsCsv(accountsData);
        return new NextResponse(csv, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filenameBase}.csv"`,
          },
        });
      }
      const buffer = buildAllAccountsXlsx(accountsData);
      return new NextResponse(buffer, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filenameBase}.xlsx"`,
        },
      });
    }

    const account = ACCOUNTS.find((a) => a.id === accountParam);
    if (!account) {
      return NextResponse.json({ error: `Unknown account "${accountParam}".` }, { status: 400 });
    }
    const accountData = await computeAccountData(accountParam, { startDate, endDate });
    if (!accountData.configured) {
      return NextResponse.json(
        { error: `${accountData.accountName} isn't connected yet - no data to export.` },
        { status: 400 }
      );
    }
    const filenameBase = `walmart-${accountParam}_${startDate}_to_${endDate}`;

    if (format === "csv") {
      const csv = buildSingleAccountCsv(accountData);
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filenameBase}.csv"`,
        },
      });
    }
    const buffer = buildSingleAccountXlsx(accountData);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filenameBase}.xlsx"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
