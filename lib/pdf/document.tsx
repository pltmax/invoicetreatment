import React from "react";
import { formatEuros, formatDateFr, formatIbanGrouped, formatCategory } from "../format";

export interface InvoicePdfData {
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  category: string;
  amountExclVatCents: number;
  amountInclVatCents: number;
  printedIban: string;
  printedSiren: string;
  printedVatNumber: string;
  supplierName: string;
  supplierSiret: string;
  entityName: string;
}

/**
 * Builds the invoice PDF element tree.
 *
 * @react-pdf/renderer is imported dynamically, and this module deliberately keeps
 * it out of its static import graph. The renderer and its dependency
 * @react-pdf/textkit are native ESM, and textkit statically imports
 * "@react-pdf/hyphenate/en-us" — a subpath whose exports map declares only "types"
 * and "import" conditions, with no "require" and no "default". The root
 * package.json has no "type": "module", so tsx treats this file as CommonJS and
 * transpiles static imports to require(); resolving that subpath with CJS semantics
 * cannot satisfy it and fails with ERR_PACKAGE_PATH_NOT_EXPORTED when
 * scripts/seed.ts runs. A dynamic import is preserved as a real ESM import, so the
 * chain resolves through the ESM resolver instead.
 */
export async function buildInvoicePdfDocument(data: InvoicePdfData) {
  const { Document, Page, Text, View, StyleSheet } = await import("@react-pdf/renderer");

  const styles = StyleSheet.create({
    page: { padding: 32, fontSize: 10, fontFamily: "Helvetica" },
    row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
    label: { color: "#666666", marginBottom: 2 },
    title: { fontSize: 14, marginBottom: 4 },
    table: { marginTop: 24, borderTop: 1, borderColor: "#cccccc" },
    tableRow: { flexDirection: "row", borderBottom: 1, borderColor: "#eeeeee", paddingVertical: 6 },
    cell: { flex: 1 },
    cellRight: { flex: 1, textAlign: "right" },
  });

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.row}>
          <View>
            <Text style={styles.title}>{data.supplierName}</Text>
            <Text style={styles.label}>SIREN {data.printedSiren}</Text>
            <Text style={styles.label}>SIRET {data.supplierSiret}</Text>
            <Text style={styles.label}>TVA {data.printedVatNumber}</Text>
          </View>
          <View>
            <Text style={styles.label}>Facturé à</Text>
            <Text style={styles.title}>{data.entityName}</Text>
          </View>
        </View>

        <View style={styles.row}>
          <View>
            <Text style={styles.label}>Facture n°</Text>
            <Text>{data.invoiceNumber}</Text>
          </View>
          <View>
            <Text style={styles.label}>Émise le</Text>
            <Text>{formatDateFr(data.issueDate)}</Text>
          </View>
          <View>
            <Text style={styles.label}>Échéance</Text>
            <Text>{formatDateFr(data.dueDate)}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableRow}>
            <Text style={styles.cell}>{formatCategory(data.category)}</Text>
            <Text style={styles.cellRight}>{formatEuros(data.amountExclVatCents)} HT</Text>
            <Text style={styles.cellRight}>{formatEuros(data.amountInclVatCents)} TTC</Text>
          </View>
        </View>

        <View style={{ marginTop: 24 }}>
          <Text style={styles.label}>IBAN</Text>
          <Text>{formatIbanGrouped(data.printedIban)}</Text>
        </View>
      </Page>
    </Document>
  );
}
