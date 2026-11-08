"""Import the supplied Word templates without rebuilding their formatting.

Usage: python3 scripts/hr/prepare-offer-templates.py /path/to/source/documents
Only explicitly mapped variable paragraphs change; originals remain byte-identical.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import html
import json
import re
import shutil
import sys
import xml.etree.ElementTree as ET

SOURCE = Path(sys.argv[1])
DEST = Path(__file__).resolve().parents[2] / 'server/hr/assets/offers'
DEST.mkdir(parents=True, exist_ok=True)
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}

LABELS = {
    'candidateName': ('اسم المرشح', 'Candidate name'), 'email': ('بريد المرشح', 'Candidate email'),
    'jobTitle': ('المسمى الوظيفي', 'Job title'), 'department': ('القسم', 'Department'),
    'reportingTo': ('المدير المباشر', 'Reporting to'), 'offerDate': ('تاريخ العرض / العقد', 'Offer / contract date'),
    'validUntil': ('صالح حتى', 'Valid until'), 'joiningDate': ('تاريخ المباشرة', 'Joining date'),
    'workLocation': ('مكان العمل', 'Work location'), 'basicSalary': ('الأجر الأساسي', 'Basic salary'),
    'transportAllowance': ('بدل انتقالات', 'Transportation allowance'), 'workAllowance': ('بدل طبيعة العمل', 'Nature of work allowance'),
    'skillAllowance': ('بدل مهارة', 'Skill allowance'), 'housingAllowance': ('بدل سكن', 'Housing allowance'),
    'livingAllowance': ('بدل غلاء المعيشة', 'Cost of living allowance'), 'kpiBonus': ('حافز الأداء', 'KPI bonus'),
    'grossSalary': ('إجمالي الراتب الشهري', 'Gross monthly salary'),
    'salaryAfterProbation': ('الراتب بعد ثلاثة أشهر', 'Salary after three months'),
    'nationalId': ('الرقم القومي', 'National ID'), 'birthDate': ('تاريخ الميلاد', 'Date of birth'),
    'address': ('عنوان المرشح', 'Candidate address'), 'phone': ('رقم الهاتف', 'Phone number'),
    'contractDay': ('يوم تحرير العقد', 'Contract weekday'), 'companyAddress': ('عنوان الشركة', 'Company address'),
    'commercialRegister': ('السجل التجاري', 'Commercial registration'), 'dailyHours': ('ساعات العمل اليومية', 'Daily hours'),
    'workingDays': ('أيام العمل', 'Working days'), 'daysOff': ('الراحة الأسبوعية', 'Weekly days off'),
    'payDay': ('يوم صرف الأجر', 'Salary payment day'), 'internetAllowance': ('بدل اتصالات وإنترنت', 'Internet / communications allowance'),
    'project': ('اسم المشروع', 'Project'), 'duration': ('مدة المشروع', 'Project duration'),
    'estimatedHours': ('الساعات التقديرية', 'Estimated hours'), 'projectFee': ('أتعاب المشروع', 'Project fee'),
    'feeWords': ('الأتعاب كتابةً', 'Fee in words'), 'deliverable1': ('المخرج الأول', 'Deliverable 1'),
    'deliverable2': ('المخرج الثاني', 'Deliverable 2'), 'deliverable3': ('المخرج الثالث', 'Deliverable 3'),
    'milestone1': ('موعد المرحلة الأولى', 'Milestone 1 date'), 'milestone2': ('موعد المرحلة الثانية', 'Milestone 2 date'),
    'finalDelivery': ('التسليم النهائي', 'Final delivery'), 'salaryWords': ('الراتب كتابةً', 'Salary in words'),
    'fixedSalary': ('الراتب الثابت', 'Fixed salary'), 'trainingSalary': ('راتب التدريب', 'Training salary'),
    'insuranceAmount': ('حصة التأمين بالجنيه', 'Insurance contribution in EGP'),
    'interviewDate': ('تاريخ المقابلة', 'Interview date'), 'referenceNo': ('الرقم المرجعي', 'HR reference'),
    'age': ('العمر', 'Age'), 'nationality': ('الجنسية', 'Nationality'),
    'militaryStatus': ('الموقف من التجنيد', 'Military status'), 'maritalStatus': ('الحالة الاجتماعية', 'Marital status'),
}
MONEY = {'basicSalary','transportAllowance','workAllowance','skillAllowance','housingAllowance','livingAllowance','kpiBonus','grossSalary','salaryAfterProbation','internetAllowance','projectFee','fixedSalary','trainingSalary','insuranceAmount'}

def tok(key): return '{{' + key + '}}'

catalog = []

def make(id, filename, ar, en, language, kind, mappings, defaults=None, optional=None, sums=None):
    defaults, optional = defaults or {}, set(optional or [])
    original = SOURCE / filename
    shutil.copyfile(original, DEST / (id + '-original.docx'))
    with ZipFile(original) as z:
        xml = z.read('word/document.xml').decode()
        root = ET.fromstring(xml)
        paragraphs = root.findall('.//w:p', NS)
        source_text = [''.join(t.text or '' for t in p.findall('.//w:t', NS)) for p in paragraphs]
        # Mappings by index are intentional: repeated empty cells have distinct jobs.
        replacements = {i: (v(source_text[i]) if callable(v) else v) for i,v in mappings.items()}
        if id == 'offer-en-appendix':
            for i, text in enumerate(source_text):
                if i not in replacements and 'Sales Operations Manager' in text:
                    replacements[i] = text.replace('Sales Operations Manager', tok('jobTitle'))
        index = -1
        def replace_paragraph(match):
            nonlocal index
            index += 1
            if index not in replacements: return match.group()
            paragraph, value = match.group(), html.escape(replacements[index], quote=False)
            if paragraph.endswith('/>'):
                paragraph = paragraph[:-2] + '></w:p>'
            first = True
            def replace_text(m):
                nonlocal first
                content = value if first else ''
                first = False
                return m.group(1) + content + m.group(3)
            paragraph = re.sub(r'(<w:t\b[^>]*>)(.*?)(</w:t>)', replace_text, paragraph, flags=re.S)
            if first:
                paragraph = paragraph.replace('</w:p>', '<w:r><w:t xml:space="preserve">'+value+'</w:t></w:r></w:p>')
            return paragraph
        xml = re.sub(r'<w:p\b[^>]*?/>|<w:p\b[^>]*>.*?</w:p>', replace_paragraph, xml, flags=re.S)
        assert index + 1 == len(paragraphs), 'Paragraph mapping must match the source exactly'
        with ZipFile(DEST / (id + '.docx'), 'w', ZIP_DEFLATED) as output:
            for info in z.infolist():
                output.writestr(info, xml.encode() if info.filename == 'word/document.xml' else z.read(info.filename))
        root = ET.fromstring(xml)
        def ptext(p): return ''.join(t.text or '' for t in p.findall('.//w:t', NS))
        blocks=[]
        for child in root.find('w:body', NS):
            if child.tag.endswith('}p'):
                text=ptext(child)
                if text.strip(): blocks.append({'type':'paragraph','text':text})
            elif child.tag.endswith('}tbl'):
                blocks.append({'type':'table','rows':[[[ptext(p) for p in cell.findall('.//w:p', NS)] for cell in row.findall('w:tc',NS)] for row in child.findall('w:tr', NS)]})
        keys=list(dict.fromkeys(re.findall(r'\{\{(\w+)\}\}',xml)))
        fields=[]
        for key in keys:
            label=LABELS[key]
            fields.append({'key':key,'label':dict(zip(['ar','en'],label)), 'type':'number' if key in MONEY or key in {'dailyHours','estimatedHours','payDay','age'} else 'date' if key.endswith('Date') or key in {'validUntil','milestone1','milestone2','finalDelivery'} else 'text', 'required':key not in optional,'default':defaults.get(key,''),'computed':key in (sums or {})})
        catalog.append({'id':id,'label':{'ar':ar,'en':en},'language':language,'kind':kind,'sourceName':filename,'sourceSha256':hashlib.sha256(original.read_bytes()).hexdigest(),'fields':fields,'blocks':blocks,'sums':sums or {}})

salary_keys=['basicSalary','transportAllowance','workAllowance','skillAllowance','housingAllowance','livingAllowance','kpiBonus','grossSalary']
salary_defaults={k:'0' for k in salary_keys[1:-1]}
for id,filename,ar,en,language in [
 ('offer-ar','Engosoft_Job_Offer_AR.docx','عرض عمل عربي','Arabic job offer','ar'),
 ('offer-en','Engosoft_Job_Offer_EN.docx','عرض عمل إنجليزي','English job offer','en'),
 ('offer-en-appendix','Engosoft_Job_Offer_EN_with_Appendix.docx','عرض مدير عمليات المبيعات مع ملحق KPI','Sales Operations offer with KPI appendix','en')]:
    m={3:tok('offerDate'),5:tok('validUntil'),7:tok('candidateName'),9:tok('joiningDate'),14:tok('jobTitle'),27:tok('jobTitle'),29:tok('department'),31:tok('reportingTo'),35:tok('workLocation')}
    m[11]=('السيد/ السيدة '+tok('candidateName')+' المحترم/ة،') if language=='ar' else 'Dear '+tok('candidateName')+','
    m[12]=lambda s:re.sub(r'\[[^\]]+\]',tok('jobTitle'),s)
    m[15]=('القسم: ' if language=='ar' else 'Department: ')+tok('department')
    m[23]=(tok('grossSalary')+' جنيه') if language=='ar' else 'EGP '+tok('grossSalary')
    for i,k in zip([79,82,85,88,91,94,97,100],salary_keys):m[i]=tok(k)
    accept_indices=[142] if language=='ar' else [145,266] if id.endswith('appendix') else [144]
    for i in accept_indices:
        m[i]=lambda s:s.replace('______________________________',tok('candidateName')).replace('[المسمى الوظيفي]',tok('jobTitle')).replace('[Position]',tok('jobTitle')).replace('…… / …… / 2026',tok('joiningDate'))
    if id.endswith('appendix'):
        m[104]=lambda s:re.sub(r'\b\d{4,}\b',tok('salaryAfterProbation'),s)
        m[150]=lambda s:re.sub(r'\[[^\]]+\]',lambda m:tok('candidateName') if m.start()<s.index('for the position') else tok('jobTitle'),s)
        m[152]=tok('jobTitle');m[153]='Department: '+tok('department')
    make(id,filename,ar,en,language,'offer',m,{**salary_defaults,'workLocation':'مقر الشركة' if language=='ar' else 'Company office',**({'jobTitle':'Sales Operations Manager','department':'Sales'} if id.endswith('appendix') else {})},sums={'grossSalary':salary_keys[:-1]})

m={3:tok('offerDate'),7:tok('candidateName')+' (العامل)',9:tok('joiningDate'),11:lambda s:s.replace('…………',tok('contractDay')).replace('…… / …… / 2026',tok('offerDate')),13:tok('jobTitle'),14:'القسم: '+tok('department'),19:tok('dailyHours')+' ساعات / يوم',22:tok('grossSalary')+' جنيه',28:'العنوان: '+tok('companyAddress')+'  —  سجل تجاري رقم: '+tok('commercialRegister'),30:'السيد/ السيدة: '+tok('candidateName'),32:tok('nationalId')+'    تاريخ الميلاد: '+tok('birthDate'),34:tok('address'),36:'الهاتف: '+tok('phone')+'    البريد الإلكتروني: '+tok('email'),39:tok('jobTitle'),41:tok('department'),43:'المدير المباشر: '+tok('reportingTo'),45:'مقر الشركة / عن بُعد (يُحدد بالاتفاق): '+tok('workLocation'),63:tok('workingDays'),65:tok('dailyHours')+' ساعات، بما لا يجاوز الحدود القصوى المقررة قانونًا',67:tok('daysOff')+' (مدفوعة الأجر، بما لا تقل عن المدة التي يقررها القانون)',92:lambda s:s.replace('……',tok('payDay')),154:lambda s:s.replace('……………………………………………………',tok('candidateName')).replace('…………………………',tok('nationalId')).replace('…… / …… / 2026',tok('joiningDate'))}
contract_keys=['basicSalary','transportAllowance','internetAllowance','workAllowance','grossSalary']
for i,k in zip([77,80,83,86,89],contract_keys):m[i]=tok(k)
make('contract-ar','Engosoft_Employment_Contract_AR.docx','عقد عمل عربي','Arabic employment contract','ar','contract',m,{'dailyHours':'8','transportAllowance':'0','internetAllowance':'0','workAllowance':'0'},sums={'grossSalary':contract_keys[:-1]})

m={3:tok('offerDate'),5:tok('validUntil'),7:tok('candidateName'),9:tok('project'),11:'Dear '+tok('candidateName')+',',12:lambda s:s.replace('UI/UX Designer',tok('jobTitle')),15:tok('jobTitle'),17:tok('duration'),20:tok('estimatedHours')+' hrs',23:'EGP '+tok('projectFee'),27:tok('jobTitle')+' (freelance)',29:tok('department'),31:tok('reportingTo'),38:tok('project'),40:'1.  '+tok('deliverable1'),41:'2.  '+tok('deliverable2'),42:'3.  '+tok('deliverable3'),50:tok('joiningDate'),52:'Milestone 1: '+tok('milestone1')+'     Milestone 2: '+tok('milestone2'),54:tok('finalDelivery'),62:'EGP '+tok('projectFee')+' ('+tok('feeWords')+' Egyptian Pounds), fixed for the scope above.',100:'I, '+tok('candidateName')+', National ID No. '+tok('nationalId')+', have read and understood this offer and accept the engagement as an independent contractor on the terms above.',101:'I am available to start on: '+tok('joiningDate')+'.'}
make('freelance-uiux','Engosoft_Freelance_UIUX_Offer_Template.docx','عرض فريلانس UI/UX','Freelance UI/UX engagement','en','freelance',m,{'jobTitle':'UI/UX Designer','department':'Marketing','reportingTo':'Marketing Manager'},optional=['deliverable2','deliverable3'])

m={5:'Job Offer Date: '+tok('offerDate'),6:'Hiring Date: '+tok('joiningDate'),7:'Dear '+tok('candidateName')+',',10:lambda s:s.replace('LMS Manager',tok('jobTitle')),14:'Position: '+tok('jobTitle'),15:'Report to: '+tok('reportingTo'),16:'Department: '+tok('department'),20:'Salary (Gross Salary): You will receive '+tok('grossSalary')+' EGP ('+tok('salaryWords')+' Egyptian Pounds).',23:tok('grossSalary'),24:tok('fixedSalary')+' Fixed + '+tok('kpiBonus')+' KPIs Paid Monthly (Based on Performance on Company achievement)',31:'('+tok('basicSalary')+') Discount Percentage Entity Type of Insurance.',33:tok('transportAllowance'),35:tok('workAllowance'),37:tok('skillAllowance'),39:tok('housingAllowance'),41:tok('livingAllowance'),46:'11% from the Social Insurance Amount = '+tok('insuranceAmount')+' L.E + Employment gain tax from Basic salary as company policies',55:tok('trainingSalary')+' EGP/month',95:'I, '+tok('candidateName')+' have read and understood the contents of the above offer and I will be able to join your company at '+tok('joiningDate')+'.'}
make('lms-manager','Engosoft-Job offer - LMS Manager.docx','عرض مدير LMS (ثلاثة أشهر)','LMS Manager offer (three months)','en','offer',m,{'jobTitle':'LMS Manager','department':'LMS','reportingTo':'CEO',**salary_defaults},sums={'fixedSalary':salary_keys[:-2],'grossSalary':salary_keys[:-1]})

make('application','Engosoft_Employment_Application_Redesigned.docx','طلب توظيف ثنائي اللغة','Bilingual employment application','ar','application',{6:tok('interviewDate'),9:tok('referenceNo'),14:tok('jobTitle'),17:tok('candidateName'),20:tok('nationalId'),23:tok('birthDate'),26:tok('age'),29:tok('phone'),32:tok('email'),35:tok('address'),38:tok('nationality'),41:tok('militaryStatus'),44:tok('maritalStatus'),232:tok('candidateName'),235:tok('jobTitle'),238:tok('interviewDate'),241:tok('department')},optional=['interviewDate','referenceNo','nationalId','birthDate','age','phone','address','nationality','militaryStatus','maritalStatus','department'])

handbook=SOURCE/'Engosoft_Employee_Handbook_RTL_Fixed_2026.docx 2222.docx'
shutil.copyfile(handbook,DEST/'employee-handbook.docx')
(DEST/'catalog.json').write_text(json.dumps({'version':'2026-11-08','handbook':{'filename':'Engosoft_Employee_Handbook_2026.docx','sourceSha256':hashlib.sha256(handbook.read_bytes()).hexdigest()},'templates':catalog},ensure_ascii=False,indent=2)+'\n')
print('Prepared',len(catalog),'templates and the unchanged handbook.')
