' 用 Word 打开 DOCX 并导出 PDF（VBScript 走 IDispatch，绕开 PS 的 interop 类型库问题）
Option Explicit
Dim docx, pdf, word, doc, pages
docx = WScript.Arguments(0)
pdf  = WScript.Arguments(1)
On Error Resume Next
Set word = CreateObject("Word.Application")
If Err.Number <> 0 Then
  WScript.Echo "ERR create: " & Err.Description
  WScript.Quit 2
End If
word.Visible = False
word.DisplayAlerts = 0
Set doc = word.Documents.Open(docx, False, True)
If Err.Number <> 0 Then
  WScript.Echo "ERR open: " & Err.Description & " (0x" & Hex(Err.Number) & ")"
  word.Quit
  WScript.Quit 3
End If
doc.Repaginate
pages = doc.ComputeStatistics(2)
WScript.Echo "pages=" & pages
doc.ExportAsFixedFormat pdf, 17
If Err.Number <> 0 Then
  WScript.Echo "ERR export: " & Err.Description
  doc.Close 0
  word.Quit
  WScript.Quit 4
End If
doc.Close 0
word.Quit
WScript.Echo "ok"
