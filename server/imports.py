"""Strict workbook review: never auto-match farm records by fuzzy name."""
from datetime import date, datetime
from io import BytesIO, StringIO
import csv
import re
from openpyxl import load_workbook
from pypdf import PdfReader

NAMES={
    'field':{'поле','название поля','field','field name','field_name','id поля','field id'},
    'year':{'год','year'},
    'crop':{'культура','crop','crop name'},
    'yield':{'урожайность','урожайность т/га','yield','yield t/ha'},
    'sown':{'посев','дата посева','sow','sown'},
    'harvested':{'уборка','дата уборки','harvest'},
}

def norm(x):return str(x or '').strip().casefold()

def parse_date(value):
    if isinstance(value,(datetime,date)):return value.strftime('%Y-%m-%d')
    val=str(value or '').strip()
    if not val:return ''
    for fmt in ('%Y-%m-%d','%d.%m.%Y','%d/%m/%Y'):
        try:return datetime.strptime(val,fmt).strftime('%Y-%m-%d')
        except ValueError:pass
    return ''

def parse_row(vals, columns, line, sheet):
    def get(k):
        i=columns.get(k)
        return vals[i] if i is not None and i<len(vals) else None
    field=str(get('field') or '').strip()
    crop=str(get('crop') or '').strip()
    try:
        year=int(get('year'))
        if not (1980<=year<=2100):raise ValueError()
    except (TypeError,ValueError):year=None
    try:
        val=get('yield')
        yield_value=float(str(val).replace(' ','').replace(',','.')) if val is not None and str(val).strip() else None
        if yield_value is not None and not (0<=yield_value<=100):raise ValueError()
    except (ValueError,TypeError):yield_value=None
    errors=[]
    if not field:errors.append('Не указано поле')
    if not crop:errors.append('Не указана культура')
    if year is None:errors.append('Неверный год')
    return {'line':line,'sheet':sheet,'field':field,'year':year,'crop':crop,'yield':yield_value,
            'sown':parse_date(get('sown')),'harvested':parse_date(get('harvested')),'errors':errors}

def inspect_table(rows,sheet):
    # Header may be preceded by a title/metadata: scan first 15 rows.
    matrix=list(rows)
    header_index=None; cols=None
    for i, row in enumerate(matrix[:15]):
        normalized=[norm(v) for v in row]
        mapped={k:next((j for j,h in enumerate(normalized) if h in names),None) for k,names in NAMES.items()}
        if all(mapped.get(k) is not None for k in ('field','year','crop')):
            header_index=i;cols=mapped;break
    if header_index is None:return [],f'{sheet}: нет колонок «Поле», «Год», «Культура»'
    records=[]
    for index, row in enumerate(matrix[header_index+1:],start=header_index+2):
        if not any(v is not None and str(v).strip() for v in row):continue
        records.append(parse_row(row,cols,index,sheet))
    return records,None

def inspect_file(name: str, content: bytes):
    ext=name.rsplit('.',1)[-1].lower()
    if ext=='pdf':
        try:
            reader=PdfReader(BytesIO(content))
            fragments=[(p.extract_text() or '') for p in reader.pages[:5]]
            return {'kind':'pdf','rows':[],'errors':[],
                    'preview':'\n'.join(fragments)[:3500],
                    'notice':'PDF приложен как источник. Показатели не переносятся в почву автоматически без проверки.'}
        except Exception as exc:raise ValueError('Не удалось прочитать PDF') from exc
    if ext=='xlsx':
        try:
            book=load_workbook(BytesIO(content),read_only=True,data_only=True)
            all_rows=[]; errors=[]
            for sheet in book.worksheets:
                rows,error=inspect_table(sheet.iter_rows(values_only=True),sheet.title)
                all_rows.extend(rows)
                if error:errors.append(error)
            book.close()
        except Exception as exc:raise ValueError('Неправильный или повреждённый XLSX') from exc
        return {'kind':'history','rows':all_rows[:1200],'errors':errors,'notice':'Проверьте точное совпадение имени или ID поля.'}
    if ext=='csv':
        try:
            try: raw=content.decode('utf-8-sig')
            except UnicodeDecodeError:raw=content.decode('cp1251')
            sample=raw[:4000]
            try: dialect=csv.Sniffer().sniff(sample,delimiters=',;\t')
            except csv.Error:dialect=csv.excel
            rows,error=inspect_table(csv.reader(StringIO(raw),dialect),'CSV')
            return {'kind':'history','rows':rows[:1200],'errors':[error] if error else [],
                    'notice':'Проверьте точное совпадение имени или ID поля.'}
        except Exception as exc:raise ValueError('Не удалось разобрать CSV') from exc
    raise ValueError('Поддерживаются CSV, XLSX и PDF; XLS сначала пересохраните как XLSX')
