import { db } from "@/lib/db/client";
import { SEED_HISTORY_SESSION_PREFIX } from "@/lib/db/seed";

export const dynamic = "force-dynamic";

interface Check {
  label: string;
  pass: boolean;
  detail: string;
}

export default async function DemoCheckPage() {
  const pendingResult = await db.execute("SELECT COUNT(*) as count FROM invoices WHERE status = 'pending'");
  const pendingCount = Number(pendingResult.rows[0].count);

  const levelResult = await db.execute(`
    SELECT classifications.level AS level, COUNT(*) as count
    FROM invoices
    JOIN classifications ON classifications.invoice_id = invoices.id
    WHERE invoices.status = 'pending'
    GROUP BY classifications.level
  `);
  const levelCounts: Record<string, number> = { green: 0, orange: 0, red: 0 };
  for (const row of levelResult.rows) {
    levelCounts[String(row.level)] = Number(row.count);
  }

  // Excludes seed.ts's backfilled 12-month approval history, which isn't a
  // decision made during this demo session.
  const decisionsResult = await db.execute({
    sql: "SELECT COUNT(*) as count FROM decisions WHERE session_id NOT LIKE ?",
    args: [`${SEED_HISTORY_SESSION_PREFIX}%`],
  });
  const decisionsCount = Number(decisionsResult.rows[0].count);

  const checks: Check[] = [
    {
      label: "13 factures en attente",
      pass: pendingCount === 13,
      detail: `${pendingCount} facture${pendingCount === 1 ? "" : "s"} en attente`,
    },
    {
      label: "Répartition 2 vert / 4 orange / 7 rouge",
      pass: levelCounts.green === 2 && levelCounts.orange === 4 && levelCounts.red === 7,
      detail: `${levelCounts.green} vert · ${levelCounts.orange} orange · ${levelCounts.red} rouge`,
    },
    {
      label: "Aucune session de décision existante",
      pass: decisionsCount === 0,
      detail: `${decisionsCount} décision${decisionsCount === 1 ? "" : "s"} enregistrée${decisionsCount === 1 ? "" : "s"}`,
    },
  ];

  const allPass = checks.every((check) => check.pass);

  return (
    <div className="space-y-4 px-4 py-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Vérification de la démo</h1>
        <p className="mt-1 text-sm text-gray-500">
          À exécuter juste après « Réinitialiser la démo », avant une présentation.
        </p>
      </div>

      <ul className="divide-y divide-gray-200 rounded border border-gray-200">
        {checks.map((check) => (
          <li key={check.label} className="flex items-start justify-between gap-3 p-4">
            <div>
              <div className="font-medium text-gray-900">{check.label}</div>
              <div className="text-sm text-gray-500">{check.detail}</div>
            </div>
            <span
              className={`shrink-0 rounded px-2 py-1 text-xs font-semibold ${
                check.pass ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
              }`}
            >
              {check.pass ? "PASS" : "FAIL"}
            </span>
          </li>
        ))}
      </ul>

      <p className={`text-sm font-medium ${allPass ? "text-green-700" : "text-red-700"}`}>
        {allPass ? "Tous les contrôles sont au vert." : "Au moins un contrôle a échoué."}
      </p>
    </div>
  );
}
