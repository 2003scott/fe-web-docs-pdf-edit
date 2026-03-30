
import { PDFDocument, PDFTextField, rgb, StandardFonts } from "pdf-lib"
import { useEffect, useMemo, useRef, useState } from "react"
import { Document, Page, pdfjs } from "react-pdf"
import "react-pdf/dist/Page/AnnotationLayer.css"
import "react-pdf/dist/Page/TextLayer.css"

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()

type TextEdit = {
  id: string
  page: number
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  originalText: string
  newText: string
}

type DraftEdit = {
  page: number
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  originalText: string
  newText: string
}

type NativeTextField = {
  name: string
  originalValue: string
  value: string
}

function wrapTextToWidth(text: string, maxWidth: number, fontSize: number, font: Awaited<ReturnType<PDFDocument["embedFont"]>>) {
  const paragraphs = text.split(/\r?\n/)
  const lines: string[] = []

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean)

    if (words.length === 0) {
      lines.push("")
      continue
    }

    let currentLine = words[0]

    for (let index = 1; index < words.length; index += 1) {
      const candidate = `${currentLine} ${words[index]}`
      const candidateWidth = font.widthOfTextAtSize(candidate, fontSize)

      if (candidateWidth <= maxWidth) {
        currentLine = candidate
      } else {
        lines.push(currentLine)
        currentLine = words[index]
      }
    }

    lines.push(currentLine)
  }

  return lines
}

export const Home = () => {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null)
  const [fileName, setFileName] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [pageWidth, setPageWidth] = useState(0)
  const [pageHeight, setPageHeight] = useState(0)
  const [draftEdit, setDraftEdit] = useState<DraftEdit | null>(null)
  const [selectedEditId, setSelectedEditId] = useState<string | null>(null)
  const [nativeTextFields, setNativeTextFields] = useState<NativeTextField[]>([])
  const [flattenNativeFields, setFlattenNativeFields] = useState(true)
  const pageContainerRef = useRef<HTMLDivElement | null>(null)

  const [edits, setEdits] = useState<TextEdit[]>([])
  const pdfFile = useMemo(() => {
    if (!pdfBytes) {
      return null
    }

    return { data: pdfBytes.slice() }
  }, [pdfBytes])
  const selectedEdit = useMemo(() => {
    if (!selectedEditId) {
      return null
    }

    return edits.find((item) => item.id === selectedEditId) ?? null
  }, [edits, selectedEditId])
  const nativeFieldsChanged = useMemo(() => {
    return nativeTextFields.some((field) => field.value !== field.originalValue)
  }, [nativeTextFields])

  useEffect(() => {
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl)
      }
    }
  }, [pdfUrl])

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")

    if (!isPdf) {
      setError("Solo se permiten archivos PDF.")
      return
    }

    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl)
    }

    const bytes = new Uint8Array(await file.arrayBuffer())

    let detectedNativeFields: NativeTextField[] = []
    try {
      const parsedPdf = await PDFDocument.load(bytes.slice())
      const parsedForm = parsedPdf.getForm()
      const parsedFields = parsedForm.getFields()

      detectedNativeFields = parsedFields
        .filter((field): field is PDFTextField => field instanceof PDFTextField)
        .map((field) => {
          const currentValue = field.getText() ?? ""

          return {
            name: field.getName(),
            originalValue: currentValue,
            value: currentValue,
          }
        })
    } catch {
      detectedNativeFields = []
    }

    setError("")
    setFileName(file.name)
    setPdfBytes(bytes)
    setNativeTextFields(detectedNativeFields)
    setFlattenNativeFields(true)
    setEdits([])
    setDraftEdit(null)
    setSelectedEditId(null)
    setCurrentPage(1)
    setNumPages(0)
    setZoom(1)
    setPageWidth(0)
    setPageHeight(0)
    setPdfUrl(URL.createObjectURL(file))
  }

  const handlePdfLoadSuccess = ({ numPages: totalPages }: { numPages: number }) => {
    setNumPages(totalPages)
    setCurrentPage(1)
    setDraftEdit(null)
    setSelectedEditId(null)
  }

  const handlePageLoadSuccess = (pageProxy: { getViewport: (params: { scale: number }) => { width: number; height: number } }) => {
    const viewport = pageProxy.getViewport({ scale: 1 })
    setPageWidth(viewport.width)
    setPageHeight(viewport.height)
  }

  const createDraftFromSelection = () => {
    if (!pageWidth || !pageHeight || !pageContainerRef.current) {
      return
    }

    const selection = window.getSelection()

    if (!selection || selection.rangeCount === 0) {
      return
    }

    const selectedText = selection.toString().trim()

    if (!selectedText) {
      return
    }

    const range = selection.getRangeAt(0)
    const textLayer = pageContainerRef.current.querySelector(".react-pdf__Page__textContent")

    if (
      !textLayer ||
      !textLayer.contains(range.startContainer) ||
      !textLayer.contains(range.endContainer)
    ) {
      return
    }

    const selectionRect = range.getBoundingClientRect()
    const pageRect = pageContainerRef.current.getBoundingClientRect()

    if (selectionRect.width <= 0 || selectionRect.height <= 0 || pageRect.width <= 0 || pageRect.height <= 0) {
      return
    }

    const relativeLeft = (selectionRect.left - pageRect.left) / pageRect.width
    const relativeRight = (selectionRect.right - pageRect.left) / pageRect.width
    const relativeTop = (selectionRect.top - pageRect.top) / pageRect.height
    const relativeBottom = (selectionRect.bottom - pageRect.top) / pageRect.height

    const x = Math.max(0, relativeLeft * pageWidth)
    const width = Math.max(20, (relativeRight - relativeLeft) * pageWidth)
    const yBottom = Math.max(0, pageHeight - relativeBottom * pageHeight)
    const height = Math.max(16, (relativeBottom - relativeTop) * pageHeight)
    const recommendedFontSize = Math.max(10, Math.min(36, Math.round(height * 0.65)))

    setError("")
    setDraftEdit({
      page: currentPage,
      x,
      y: yBottom,
      width,
      height,
      fontSize: recommendedFontSize,
      originalText: selectedText,
      newText: selectedText,
    })
    setSelectedEditId(null)

    selection.removeAllRanges()
  }

  const handlePageMouseUp = () => {
    window.setTimeout(() => {
      createDraftFromSelection()
    }, 0)
  }

  const handlePageDoubleClick = () => {
    window.setTimeout(() => {
      createDraftFromSelection()
    }, 0)
  }

  const handleConfirmInlineEdit = () => {
    if (!draftEdit) {
      return
    }

    if (!draftEdit.newText.trim()) {
      setError("El texto nuevo no puede estar vacio.")
      return
    }

    setError("")

    const edit: TextEdit = {
      id: crypto.randomUUID(),
      page: draftEdit.page,
      x: draftEdit.x,
      y: draftEdit.y,
      width: draftEdit.width,
      height: draftEdit.height,
      fontSize: draftEdit.fontSize,
      originalText: draftEdit.originalText,
      newText: draftEdit.newText,
    }

    setEdits((prev) => [...prev, edit])
    setSelectedEditId(edit.id)
    setDraftEdit(null)
  }

  const handleRemoveEdit = (id: string) => {
    setEdits((prev) => prev.filter((item) => item.id !== id))
    setSelectedEditId((prev) => (prev === id ? null : prev))
  }

  const handleUpdateEdit = (id: string, patch: Partial<TextEdit>) => {
    setEdits((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  const handleUpdateNativeField = (name: string, value: string) => {
    setNativeTextFields((prev) => prev.map((field) => (field.name === name ? { ...field, value } : field)))
  }

  const handleDownloadEditedPdf = async () => {
    if (!pdfBytes) {
      setError("Primero sube un PDF.")
      return
    }

    if (edits.length === 0 && !nativeFieldsChanged) {
      setError("No hay cambios para exportar.")
      return
    }

    setSaving(true)
    setError("")

    try {
      const pdfDoc = await PDFDocument.load(pdfBytes.slice())

      if (nativeTextFields.length > 0) {
        const form = pdfDoc.getForm()

        nativeTextFields.forEach((nativeField) => {
          try {
            const field = form.getTextField(nativeField.name)
            field.setText(nativeField.value)
          } catch {
            // Ignore stale/missing field names from source PDF.
          }
        })

        if (flattenNativeFields) {
          form.flatten()
        }
      }

      const pages = pdfDoc.getPages()
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica)

      for (const edit of edits) {
        const pageIndex = edit.page - 1
        const targetPage = pages[pageIndex]

        if (!targetPage) {
          throw new Error(`La pagina ${edit.page} no existe en el PDF.`)
        }

        const fallbackWidth = Math.max((edit.originalText || edit.newText).length * edit.fontSize * 0.55, 10)
        const coverWidth = edit.width || fallbackWidth
        const lineHeight = edit.fontSize * 1.2
        const wrappedLines = wrapTextToWidth(edit.newText, coverWidth, edit.fontSize, font)
        const neededHeight = Math.max(lineHeight, wrappedLines.length * lineHeight + edit.fontSize * 0.35)
        const coverHeight = Math.max(edit.height || edit.fontSize * 1.35, neededHeight)

        targetPage.drawRectangle({
          x: edit.x,
          y: edit.y,
          width: coverWidth,
          height: coverHeight,
          color: rgb(1, 1, 1),
        })

        const textTopY = edit.y + coverHeight - edit.fontSize

        wrappedLines.forEach((line, lineIndex) => {
          targetPage.drawText(line, {
            x: edit.x,
            y: textTopY - lineIndex * lineHeight,
            size: edit.fontSize,
            font,
            color: rgb(0, 0, 0),
          })
        })
      }

      const editedBytes = await pdfDoc.save()
      const editedBytesCopy = new Uint8Array(editedBytes.length)
      editedBytesCopy.set(editedBytes)
      const blob = new Blob([editedBytesCopy.buffer], { type: "application/pdf" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      const outputName = fileName.toLowerCase().endsWith(".pdf")
        ? `${fileName.slice(0, -4)}-editado.pdf`
        : `${fileName}-editado.pdf`

      anchor.href = url
      anchor.download = outputName
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo editar el PDF."
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  const handlePrevPage = () => {
    setCurrentPage((prev) => Math.max(1, prev - 1))
    setDraftEdit(null)
  }

  const handleNextPage = () => {
    setCurrentPage((prev) => Math.min(numPages, prev + 1))
    setDraftEdit(null)
  }

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(0.6, Number((prev - 0.1).toFixed(2))))
  }

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(2.5, Number((prev + 0.1).toFixed(2))))
  }

  const handlePageInput = (value: number) => {
    if (!numPages) {
      return
    }

    const next = Math.min(Math.max(1, value || 1), numPages)
    setCurrentPage(next)
    setDraftEdit(null)
  }

  return (
    <main className="min-h-screen bg-muted/40 p-4 md:p-6">
      <div className="mx-auto grid max-w-425 grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
        <aside className="space-y-4 border bg-card p-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">PDF Editor</h1>
            <p className="text-xs text-muted-foreground">Flujo tipo Nitro: seleccion, edicion y exportacion.</p>
          </div>

          <div className="space-y-2">
            <label htmlFor="pdf-upload" className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Archivo
            </label>
            <input
              id="pdf-upload"
              type="file"
              accept="application/pdf,.pdf"
              onChange={handleFileChange}
              className="block w-full cursor-pointer border p-2 text-sm"
            />
            {fileName ? <p className="text-xs text-muted-foreground">{fileName}</p> : null}
          </div>

          <div className="space-y-2 border p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Navegacion</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={handlePrevPage} disabled={!pdfBytes || currentPage <= 1} className="border px-2 py-1 text-xs disabled:opacity-50">
                Prev
              </button>
              <input
                type="number"
                min={1}
                max={numPages || 1}
                value={currentPage}
                onChange={(e) => handlePageInput(Number(e.target.value))}
                className="w-16 border px-2 py-1 text-center text-xs"
              />
              <span className="text-xs text-muted-foreground">/ {numPages || "-"}</span>
              <button
                type="button"
                onClick={handleNextPage}
                disabled={!pdfBytes || currentPage >= numPages}
                className="border px-2 py-1 text-xs disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>

          <div className="space-y-2 border p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Zoom</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={handleZoomOut} className="border px-2 py-1 text-xs">
                -
              </button>
              <input
                type="range"
                min={0.6}
                max={2.5}
                step={0.1}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-full"
              />
              <button type="button" onClick={handleZoomIn} className="border px-2 py-1 text-xs">
                +
              </button>
              <span className="w-12 text-right text-xs text-muted-foreground">{Math.round(zoom * 100)}%</span>
            </div>
          </div>

          <div className="space-y-2 border p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cambios</p>
              <span className="text-xs text-muted-foreground">{edits.length}</span>
            </div>
            <ul className="max-h-72 space-y-2 overflow-auto text-xs">
              {edits.map((edit, index) => (
                <li
                  key={edit.id}
                  className={`cursor-pointer border p-2 ${selectedEditId === edit.id ? "border-primary bg-primary/10" : ""}`}
                  onClick={() => {
                    setSelectedEditId(edit.id)
                    setCurrentPage(edit.page)
                    setDraftEdit(null)
                  }}
                >
                  <div className="font-medium">Cambio #{index + 1} - Pag {edit.page}</div>
                  <div className="line-clamp-1 text-muted-foreground">{edit.originalText || "[sin original]"}</div>
                  <div className="line-clamp-1">{edit.newText}</div>
                </li>
              ))}
              {edits.length === 0 ? <li className="text-muted-foreground">Aun no hay cambios.</li> : null}
            </ul>
          </div>

          <div className="space-y-2 border p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Campos nativos</p>
              <span className="text-xs text-muted-foreground">{nativeTextFields.length}</span>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={flattenNativeFields}
                onChange={(e) => setFlattenNativeFields(e.target.checked)}
              />
              Aplanar campos al exportar
            </label>
            {nativeTextFields.length === 0 ? (
              <p className="text-xs text-muted-foreground">Este PDF no trae campos de texto nativos.</p>
            ) : null}
          </div>
        </aside>

        <section className="flex min-h-[80vh] flex-col border bg-background">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-card px-4 py-3">
            <div className="text-xs text-muted-foreground">Selecciona texto en el PDF para generar una edicion.</div>
            <button
              type="button"
              onClick={handleDownloadEditedPdf}
              disabled={saving}
              className="border px-3 py-2 text-xs font-medium disabled:opacity-50"
            >
              {saving ? "Generando PDF..." : "Exportar PDF"}
            </button>
          </div>

          <div className="flex-1 overflow-auto bg-muted/30 p-4">
            {pdfFile ? (
              <div className="mx-auto w-fit" ref={pageContainerRef} onMouseUp={handlePageMouseUp} onDoubleClick={handlePageDoubleClick}>
                <div className="relative inline-block shadow-lg">
                  <Document file={pdfFile} onLoadSuccess={handlePdfLoadSuccess}>
                    <Page pageNumber={currentPage} width={Math.round(900 * zoom)} onLoadSuccess={handlePageLoadSuccess} />
                  </Document>

                  {edits
                    .filter((edit) => edit.page === currentPage && pageWidth > 0 && pageHeight > 0)
                    .map((edit) => {
                      const left = `${(edit.x / pageWidth) * 100}%`
                      const top = `${((pageHeight - (edit.y + edit.height)) / pageHeight) * 100}%`
                      const width = `${(edit.width / pageWidth) * 100}%`
                      const height = `${(edit.height / pageHeight) * 100}%`
                      const isSelected = selectedEditId === edit.id

                      return (
                        <button
                          key={edit.id}
                          type="button"
                          onClick={() => {
                            setSelectedEditId(edit.id)
                            setDraftEdit(null)
                          }}
                          className={`absolute border ${isSelected ? "border-sky-500 bg-sky-500/20" : "border-emerald-500/70 bg-emerald-500/15"}`}
                          style={{ left, top, width, height }}
                          aria-label="Seleccionar cambio"
                        />
                      )
                    })}

                  {draftEdit && draftEdit.page === currentPage && pageWidth > 0 && pageHeight > 0 ? (
                    <div
                      className="pointer-events-none absolute border border-amber-500/70 bg-amber-500/15"
                      style={{
                        left: `${(draftEdit.x / pageWidth) * 100}%`,
                        top: `${((pageHeight - (draftEdit.y + draftEdit.height)) / pageHeight) * 100}%`,
                        width: `${(draftEdit.width / pageWidth) * 100}%`,
                        height: `${(draftEdit.height / pageHeight) * 100}%`,
                      }}
                    />
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[70vh] items-center justify-center text-sm text-muted-foreground">
                Carga un PDF para empezar a editar.
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-4 border bg-card p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Propiedades</h2>
            {error ? <span className="text-[11px] text-destructive">{error}</span> : null}
          </div>

          {nativeTextFields.length > 0 ? (
            <div className="space-y-3 border p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Campos del PDF</p>
              <div className="max-h-64 space-y-2 overflow-auto">
                {nativeTextFields.map((field) => (
                  <label key={field.name} className="block text-xs text-muted-foreground">
                    {field.name}
                    <input
                      type="text"
                      value={field.value}
                      onChange={(e) => handleUpdateNativeField(field.name, e.target.value)}
                      className="mt-1 w-full border p-2 text-sm"
                    />
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {draftEdit ? (
            <div className="space-y-3 border p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Borrador</p>
              <div className="text-xs text-muted-foreground">Pag {draftEdit.page}</div>
              <textarea
                value={draftEdit.newText}
                onChange={(e) => setDraftEdit((prev) => (prev ? { ...prev, newText: e.target.value } : null))}
                className="min-h-32 w-full border p-2 text-sm"
              />
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-muted-foreground">
                  Fuente
                  <input
                    type="number"
                    min={8}
                    max={64}
                    value={draftEdit.fontSize}
                    onChange={(e) =>
                      setDraftEdit((prev) =>
                        prev
                          ? {
                              ...prev,
                              fontSize: Math.max(8, Number(e.target.value) || prev.fontSize),
                            }
                          : null
                      )
                    }
                    className="mt-1 w-full border p-1 text-sm"
                  />
                </label>
              </div>
              <div className="flex gap-2">
                <button type="button" className="border px-3 py-2 text-xs" onClick={handleConfirmInlineEdit}>
                  Confirmar
                </button>
                <button type="button" className="border px-3 py-2 text-xs" onClick={() => setDraftEdit(null)}>
                  Cancelar
                </button>
              </div>
            </div>
          ) : null}

          {selectedEdit ? (
            <div className="space-y-3 border p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cambio seleccionado</p>
              <div className="text-xs text-muted-foreground">Pag {selectedEdit.page}</div>
              <label className="block text-xs text-muted-foreground">
                Texto nuevo
                <textarea
                  value={selectedEdit.newText}
                  onChange={(e) => handleUpdateEdit(selectedEdit.id, { newText: e.target.value })}
                  className="mt-1 min-h-24 w-full border p-2 text-sm"
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Tamano de fuente
                <input
                  type="number"
                  min={8}
                  max={64}
                  value={selectedEdit.fontSize}
                  onChange={(e) => handleUpdateEdit(selectedEdit.id, { fontSize: Math.max(8, Number(e.target.value) || selectedEdit.fontSize) })}
                  className="mt-1 w-full border p-2 text-sm"
                />
              </label>
              <button type="button" className="border px-3 py-2 text-xs" onClick={() => handleRemoveEdit(selectedEdit.id)}>
                Eliminar cambio
              </button>
            </div>
          ) : null}

          {!draftEdit && !selectedEdit ? (
            <div className="border p-3 text-xs text-muted-foreground">
              Selecciona texto en el lienzo para crear un borrador, o selecciona un cambio para editar sus propiedades.
            </div>
          ) : null}
        </aside>
      </div>
    </main>
  )
}