/**
 * Sahayak (सहायक) Config & Multilingual Localization Engine
 * Supports 1-click & keyboard key mapping (1: EN, 2: HI, 3: TA, 4: TE, 5: BN)
 * Provides State List, Titles, Descriptions, Identification Guides, and Live Portal URLs.
 */
window.SahayakConfig = (() => {
  const LANGUAGES = {
    "1": { code: "en", label: "[1] English", nativeName: "English" },
    "2": { code: "hi", label: "[2] हिन्दी", nativeName: "हिन्दी" },
    "3": { code: "ta", label: "[3] தமிழ்", nativeName: "தமிழ்" },
    "4": { code: "te", label: "[4] తెలుగు", nativeName: "తెలుగు" },
    "5": { code: "bn", label: "[5] বাংলা", nativeName: "বাংলা" }
  };

  const STATES_LIST = [
    { id: "National", name: "Central Govt / All India" },
    { id: "Uttar Pradesh", name: "Uttar Pradesh (उत्तर प्रदेश)" },
    { id: "Maharashtra", name: "Maharashtra (महाराष्ट्र)" },
    { id: "Delhi", name: "Delhi (दिल्ली)" },
    { id: "Tamil Nadu", name: "Tamil Nadu (தமிழ்நாடு)" },
    { id: "Karnataka", name: "Karnataka (ಕರ್ನಾಟಕ)" },
    { id: "Bihar", name: "Bihar (बिहार)" },
    { id: "West Bengal", name: "West Bengal (পশ্চিমবঙ্গ)" },
    { id: "Madhya Pradesh", name: "Madhya Pradesh (मध्य प्रदेश)" },
    { id: "Gujarat", name: "Gujarat (ગુજરાત)" },
    { id: "Rajasthan", name: "Rajasthan (राजस्थान)" },
    { id: "Kerala", name: "Kerala (கேரளா / കേരളം)" },
    { id: "Punjab", name: "Punjab (ਪੰਜਾਬ)" },
    { id: "Haryana", name: "Haryana (हरियाणा)" },
    { id: "Andhra Pradesh", name: "Andhra Pradesh (ఆంధ్రప్రదేశ్)" }
  ];

  const UI_STRINGS = {
    en: {
      modalTitle: "Sahayak Assistant — Missing Document Required",
      requiredDocLabel: "📄 File Required:",
      selectLanguageLabel: "🌐 SELECT LANGUAGE (Press key 1-5):",
      selectStateLabel: "🏛️ SELECT STATE / JURISDICTION:",
      aboutTitle: "ℹ️ WHAT IS THIS DOCUMENT?",
      identifyTitle: "🔍 HOW TO IDENTIFY THIS FILE:",
      dragDropText: "📁 Drag & Drop File Here  or",
      browseBtn: "Browse Computer",
      privacyNotice: "🔒 Protected by PrivacyAgent On-Device Redaction",
      instructionCenterTitle: "💡 HELP CENTER (Don't have this document?)",
      officialLinkPrefix: "🔗 Official State Portal:",
      openPortalBtn: "Open Portal ↗",
      onlineProcedureTitle: "🌐 ONLINE PROCEDURE:",
      offlineProcedureTitle: "🏛️ OFFLINE STATE PROCEDURE:",
      cancelBtn: "Cancel",
      submitBtn: "Attach File to Form 🚀",
      processingText: "🔒 Sanitizing document via on-device engine...",
      fileAttachedSuccess: "✅ Document sanitized and attached successfully!"
    },
    hi: {
      modalTitle: "सहायक असिस्टेंट — आवश्यक दस्तावेज चाहिए",
      requiredDocLabel: "📄 आवश्यक फ़ाइल:",
      selectLanguageLabel: "🌐 भाषा चुनें (कुंजी 1-5 दबाएं):",
      selectStateLabel: "🏛️ राज्य / क्षेत्र चुनें:",
      aboutTitle: "ℹ️ यह दस्तावेज क्या है?",
      identifyTitle: "🔍 इस फ़ाइल की पहचान कैसे करें:",
      dragDropText: "📁 फ़ाइल यहाँ खींचें और छोड़ें  या",
      browseBtn: "कंप्यूटर से चुनें",
      privacyNotice: "🔒 प्राइवेसीएजेंट ऑन-डिवाइस रिडेक्शन द्वारा सुरक्षित",
      instructionCenterTitle: "💡 सहायता केंद्र (क्या आपके पास यह दस्तावेज नहीं है?)",
      officialLinkPrefix: "🔗 आधिकारिक राज्य पोर्टल:",
      openPortalBtn: "पोर्टल खोलें ↗",
      onlineProcedureTitle: "🌐 ऑनलाइन प्रक्रिया:",
      offlineProcedureTitle: "🏛️ ऑफलाइन राज्य प्रक्रिया:",
      cancelBtn: "रद्द करें",
      submitBtn: "फॉर्म में फ़ाइल जोड़ें 🚀",
      processingText: "🔒 ऑन-डिवाइस इंजन द्वारा रिडैक्शन जारी है...",
      fileAttachedSuccess: "✅ दस्तावेज सुरक्षित रूप से संलग्न हो गया!"
    },
    ta: {
      modalTitle: "சஹாயக் உதவி — தேவையான ஆவணம் தேவை",
      requiredDocLabel: "📄 தேவையான கோப்பு:",
      selectLanguageLabel: "🌐 மொழியைத் தேர்ந்தெடுக்கவும் (விசை 1-5 அழுத்தவும்):",
      selectStateLabel: "🏛️ மாநிலத்தைத் தேர்ந்தெடுக்கவும்:",
      aboutTitle: "ℹ️ இந்த ஆவணம் என்றால் என்ன?",
      identifyTitle: "🔍 இந்த கோப்பை எவ்வாறு கண்டறிவது:",
      dragDropText: "📁 கோப்பை இங்கே இழுத்து விடவும்  அல்லது",
      browseBtn: "கணினியிலிருந்து தேர்ந்தெடுக்கவும்",
      privacyNotice: "🔒 தனியுரிமை முகவர் சாதனத்தில் பாதுகாக்கப்பட்டது",
      instructionCenterTitle: "💡 உதவி மையம் (இந்த ஆவணம் இல்லையா?)",
      officialLinkPrefix: "🔗 அதிகாரப்பூர்வ அரசு போர்ட்டல்:",
      openPortalBtn: "தளத்தைத் திறக்கவும் ↗",
      onlineProcedureTitle: "🌐 ஆன்லைன் நடைமுறை:",
      offlineProcedureTitle: "🏛️ ஆஃப்லைன் மாநில நடைமுறை:",
      cancelBtn: "ரத்து செய்",
      submitBtn: "படிவத்தில் கோப்பை இணைக்கவும் 🚀",
      processingText: "🔒 தனியுரிமை எஞ்சின் மூலம் செயலாக்கப்படுகிறது...",
      fileAttachedSuccess: "✅ ஆவணம் பாதுகாப்பாக இணைக்கப்பட்டது!"
    },
    te: {
      modalTitle: "సహాయక్ అసిస్టెంట్ — అవసరమైన పత్రం కావాలి",
      requiredDocLabel: "📄 అవసరమైన ఫైల్:",
      selectLanguageLabel: "🌐 భాషను ఎంచుకోండి (కీ 1-5 నొక్కండి):",
      selectStateLabel: "🏛️ రాష్ట్రాన్ని ఎంచుకోండి:",
      aboutTitle: "ℹ️ ఈ పత్రం అంటే ఏమిటి?",
      identifyTitle: "🔍 ఈ ఫైల్‌ను ఎలా గుర్తించాలి:",
      dragDropText: "📁 ఫైల్‌ను ఇక్కడ లాగి వదలండి  లేదా",
      browseBtn: "కంప్యూటర్‌లో వెతకండి",
      privacyNotice: "🔒 సాధనంలోనే ప్రైవసీఏజెంట్ సురక్షితం",
      instructionCenterTitle: "💡 సహాయ కేంద్రం (ఈ పత్రం మీ వద్ద లేదా?)",
      officialLinkPrefix: "🔗 అధికారిక ప్రభుత్వ పోర్టల్:",
      openPortalBtn: "పోర్టల్ తెరవండి ↗",
      onlineProcedureTitle: "🌐 ఆన్‌లైన్ విధానం:",
      offlineProcedureTitle: "🏛️ ఆఫ్‌లైన్ రాష్ట్ర విధానం:",
      cancelBtn: "రద్దు చేయి",
      submitBtn: "ఫారమ్‌లో ఫైల్‌ను జత చేయండి 🚀",
      processingText: "🔒 ఆన్-డివైస్ ప్రైవసీ ఇంజిన్ ప్రాసెస్ చేస్తోంది...",
      fileAttachedSuccess: "✅ ఫైల్ సురక్షితంగా జత చేయబడింది!"
    },
    bn: {
      modalTitle: "সহায়ক অ্যাসিস্ট্যান্ট — প্রয়োজনীয় নথি আবশ্যক",
      requiredDocLabel: "📄 প্রয়োজনীয় ফাইল:",
      selectLanguageLabel: "🌐 ভাষা নির্বাচন করুন (কী ১-৫ চাপুন):",
      selectStateLabel: "🏛️ রাজ্য নির্বাচন করুন:",
      aboutTitle: "ℹ️ এই নথিটি কী?",
      identifyTitle: "🔍 কীভাবে এই ফাইলটি সনাক্ত করবেন:",
      dragDropText: "📁 ফাইল এখানে ড্র্যাগ এবং ড্রপ করুন  অথবা",
      browseBtn: "কম্পিউটার ব্রাউজ করুন",
      privacyNotice: "🔒 অন-ডিভাইস প্রাইভেসি দ্বারা সুরক্ষিত",
      instructionCenterTitle: "💡 সাহায্য কেন্দ্র (আপনার কাছে এই নথিটি নেই?)",
      officialLinkPrefix: "🔗 অফিসিয়াল রাজ্য পোর্টাল:",
      openPortalBtn: "পোর্টাল খুলুন ↗",
      onlineProcedureTitle: "🌐 অনলাইন পদ্ধতি:",
      offlineProcedureTitle: "🏛️ অফলাইন রাজ্য পদ্ধতি:",
      cancelBtn: "বাতিল করুন",
      submitBtn: "ফর্মে ফাইল সংযুক্ত করুন 🚀",
      processingText: "🔒 অন-ডিভাইস ইঞ্জিন দ্বারা প্রক্রিয়া করা হচ্ছে...",
      fileAttachedSuccess: "✅ নথিটি সুরক্ষিতভাবে সংযুক্ত হয়েছে!"
    }
  };

  const DOCUMENT_DIRECTORY = {
    income_certificate: {
      portalName: "National Government Services Portal",
      portalUrl: "https://services.india.gov.in",
      displayTitle: {
        en: "Income Certificate (आय प्रमाण पत्र)",
        hi: "आय प्रमाण पत्र (Income Certificate)",
        ta: "வருமான சான்றிதழ் (Income Certificate)",
        te: "ఆదాయ ధృవీకరణ పత్రం (Income Certificate)",
        bn: "আয় প্রশংসাপত্র (Income Certificate)"
      },
      description: {
        en: "An official government document certifying your annual household income. It is issued by the Revenue Department / Tehsildar office and required for scholarships, fee concessions, and government welfare schemes.",
        hi: "आपकी वार्षिक पारिवारिक आय प्रमाणित करने वाला एक आधिकारिक सरकारी दस्तावेज। यह राजस्व विभाग / तहसीलदार कार्यालय द्वारा जारी किया जाता है और छात्रवृत्ति, शुल्क छूट तथा सरकारी योजनाओं के लिए आवश्यक है。",
        ta: "உங்கள் வருடாந்திர குடும்ப வருமானத்தை சான்றளிக்கும் அதிகாரப்பூர்வ அரசு ஆவணம்.",
        te: "మీ వార్షిక కుటుంబ ఆదాయాన్ని ధృవీకరించే అధికారిక ప్రభుత్వ పత్రం.",
        bn: "আপনার বার্ষিক পারিবারিক আয় শংসায়িত করার জন্য একটি অফিসিয়াল সরকারি নথি।"
      },
      howToIdentify: {
        en: "Look for 'Government of [State]' emblem at top, Tehsildar signature/digital stamp at bottom, and a 12-to-16 digit Certificate Number.",
        hi: "शीर्ष पर राज्य सरकार का प्रतीक, नीचे तहसीलदार का डिजिटल हस्ताक्षर/मुहर और 12 से 16 अंकों का प्रमाण पत्र नंबर देखें।",
        ta: "மேலே மாநில அரசு சின்னம், கீழே வட்டாட்சியர் கையொப்பம் மற்றும் 12 இலக்க சான்றிதழ் எண் இருக்கும்.",
        te: "పైన రాష్ట్ర ప్రభుత్వ చిహ్నం, కింద తహశీల్దార్ సంతకం మరియు 12-అంకెల సర్టిఫికేట్ సంఖ్యను చూడండి.",
        bn: "উপরে রাজ্য সরকারের প্রতীক, নিচে তহসিলদারের স্বাক্ষর এবং ১২-১৬ সংখ্যার সার্টিফিকেট নম্বর দেখুন।"
      },
      onlineSteps: {
        en: [
          "Click the portal link above to open official government services website.",
          "Select your State e-District portal from the list.",
          "Fill income details and upload Aadhaar & salary slip/ration card.",
          "Download the digitally signed PDF certificate upon approval."
        ],
        hi: [
          "अपनी राज्य की ई-डिस्ट्रिक्ट वेबसाइट खोलने के लिए ऊपर दिए गए लिंक पर क्लिक करें।",
          "मोबाइल नंबर और ओटीपी से लॉगिन करें या नागरिक खाता बनाएं।",
          "आय विवरण भरें और आधार व वेतन पर्ची/राशन कार्ड अपलोड करें।",
          "स्वीकृति मिलने पर डिजिटल रूप से हस्ताक्षरित पीडीएफ प्रमाण पत्र डाउनलोड करें।"
        ],
        ta: [
          "மாநில e-District தளத்தைத் திறக்க மேலே உள்ள இணைப்பைக் கிளிக் செய்யவும்.",
          "மொபைல் எண் மற்றும் OTP மூலம் உள்நுழையவும்.",
          "வருமான விவரங்களை நிரப்பி ஆதார் மற்றும் வருமான ஆதாரத்தைப் பதிவேற்றவும்.",
          "ஒப்புதலுக்குப் பிறகு டிஜிட்டல் கையொப்பமிட்ட PDF ஐப் பதிவிறக்கவும்."
        ],
        te: [
          "మీ రాష్ట్ర e-District వెబ్‌సైట్‌ను తెరవడానికి పైన ఉన్న లింక్‌ను క్లిక్ చేయండి.",
          "మొబైల్ సంఖ్య మరియు OTP ఉపయోగించి లాగిన్ చేయండి.",
          "ఆదాయ వివరాలను పూరించి ఆధార్ మరియు జీతం స్లిప్‌ను అప్‌లోడ్ చేయండి.",
          "ఆమోదం పొందిన తర్వాత డిజిటల్ సంతకం చేసిన PDFని డౌన్‌లోడ్ చేయండి."
        ],
        bn: [
          "আপনার রাজ্যের ই-ডিস্ট্রিক্ট ওয়েবসাইট খুলতে উপরে লিঙ্কে ক্লিক করুন।",
          "মোবাইল নম্বর ও ওটিপি দিয়ে লগইন করুন।",
          "আয়ের বিবরণ পূরণ করুন এবং আধার ও আয়ের প্রমাণ আপলোড করুন।",
          "অনুমোদনের পর ডিজিটালভাবে স্বাক্ষরিত পিডিএফ ডাউনলোড করুন।"
        ]
      },
      offlineSteps: {
        en: [
          "Visit your nearest Common Service Centre (CSC / Jan Seva Kendra) or Revenue / Tehsildar Office.",
          "Obtain and fill the physical Income Certificate Application Form.",
          "Attach photocopy of Aadhaar Card, Ration Card, and Income proof (Salary Slip / Affidavit).",
          "Submit at counter and receive your Application Reference Slip to collect hardcopy within 7-14 days."
        ],
        hi: [
          "अपने निकटतम जन सेवा केंद्र (CSC) या राजस्व / तहसीलदार कार्यालय में जाएं।",
          "भौतिक आय प्रमाण पत्र आवेदन पत्र प्राप्त करें और भरें।",
          "आधार कार्ड, राशन कार्ड और आय प्रमाण (वेतन पर्ची / हलफनामा) की फोटोकॉपी संलग्न करें।",
          "काउंटर पर जमा करें और 7-14 दिनों में हार्डकॉपी प्राप्त करने के लिए रसीद लें।"
        ],
        ta: [
          "உங்கள் அருகில் உள்ள CSC மையம் அல்லது வட்டாட்சியர் அலுவலகத்திற்குச் செல்லவும்.",
          "வருமான சான்றிதழ் விண்ணப்பப் படிவத்தைப் பூர்த்தி செய்யவும்.",
          "ஆதார் கார்டு மற்றும் வருமான ஆதார நகல்களை இணைக்கவும்.",
          "கவுண்டரில் சமர்ப்பித்து ஒப்புதல் சீட்டைப் பெறவும்."
        ],
        te: [
          "మీ సమీపంలోని CSC కేంద్రం లేదా తహశీల్దార్ కార్యాలయాన్ని సందర్శించండి.",
          "ఆదాయ ధృవీకరణ పత్రం దరఖాస్తు ఫారమ్‌ను పూరించండి.",
          "ఆధార్ కార్డ్ మరియు ఆదాయ ఆధారాల ఫోటోకాపీలను జత చేయండి.",
          "కౌంటర్‌లో సమర్పించి రసీదును పొందండి."
        ],
        bn: [
          "নিকটস্থ সিএসসি কেন্দ্র বা তহসিলদার অফিসে যান।",
          "আয় শংসাপত্র আবেদন ফর্ম পূরণ করুন।",
          "আধার কার্ড এবং আয়ের প্রমাণের ফটোকপি সংযুক্ত করুন।",
          "কাউন্টারে জমা দিয়ে রসিদ নিন।"
        ]
      }
    },
    aadhaar_card: {
      portalName: "UIDAI MyAadhaar Portal",
      portalUrl: "https://myaadhaar.uidai.gov.in",
      displayTitle: {
        en: "Aadhaar Card (आधार कार्ड)",
        hi: "आधार कार्ड (Aadhaar Card)",
        ta: "ஆதார் கார்டு (Aadhaar Card)",
        te: "ఆధార్ కార్డ్ (Aadhaar Card)",
        bn: "আধারের কার্ড (Aadhaar Card)"
      },
      description: {
        en: "A 12-digit unique identity card issued by the Unique Identification Authority of India (UIDAI). It serves as national proof of identity and address.",
        hi: "भारतीय विशिष्ट पहचान प्राधिकरण (UIDAI) द्वारा जारी 12-अंकों का विशिष्ट पहचान पत्र। यह राष्ट्रीय पहचान और पते का प्रमाण है।",
        ta: "இந்திய தனித்துவ அடையாள ஆணையத்தால் (UIDAI) வழங்கப்பட்ட 12 இலக்க தனித்துவ அடையாள அட்டை.",
        te: "UIDAI జారీ చేసిన 12-అంకెల ప్రత్యేక గుర్తింపు కార్డ్.",
        bn: "ইউআইডিএআই দ্বারা জারি করা ১২ সংখ্যার অনন্য পরিচয়পত্র।"
      },
      howToIdentify: {
        en: "Card displaying 'Unique Identification Authority of India', 12-digit number formatted as XXXX XXXX XXXX, and QR Code.",
        hi: "कार्ड जिस पर 'भारतीय विशिष्ट पहचान प्राधिकरण', XXXX XXXX XXXX के रूप में 12-अंकों का नंबर और QR कोड दिखाई दे।",
        ta: "12 இலக்க ஆதார் எண் மற்றும் QR குறியீடு கொண்ட அட்டை.",
        te: "12-అంకెల ఆధార్ సంఖ్య మరియు QR కోడ్ కలిగిన కార్డ్.",
        bn: "১২ সংখ্যার আধার নম্বর এবং কিউআর কোড যুক্ত কার্ড।"
      },
      onlineSteps: {
        en: [
          "Open UIDAI MyAadhaar portal using link above.",
          "Click 'Download Aadhaar' and enter your 12-digit Aadhaar / EID number.",
          "Enter OTP sent to your registered mobile phone.",
          "Download e-Aadhaar PDF."
        ],
        hi: [
          "ऊपर दिए गए लिंक से UIDAI MyAadhaar पोर्टल खोलें।",
          "'डाउनलोड आधार' पर क्लिक करें और 12-अंकों का आधार / ईआईडी दर्ज करें।",
          "रजिस्टर्ड मोबाइल पर आया OTP दर्ज करें।",
          "ई-आधार पीडीएफ डाउनलोड करें।"
        ],
        ta: [
          "UIDAI MyAadhaar தளத்தைத் திறக்கவும்.",
          "'ஆதார் பதிவிறக்கம்' என்பதைக் கிளிக் செய்து 12 இலக்க எண்ணை உள்ளிடவும்.",
          "மொபைலுக்கு வந்த OTP ஐ உள்ளிடவும்.",
          "e-Aadhaar PDF ஐப் பதிவிறக்கவும்."
        ],
        te: [
          "UIDAI MyAadhaar పోర్టల్‌ను తెరవండి.",
          "'డౌన్‌లోడ్ ఆధార్' క్లిక్ చేసి 12-అంకెల సంఖ్యను నమోదు చేయండి.",
          "మొబైల్‌కు వచ్చిన OTPని నమోదు చేయండి.",
          "e-Aadhaar PDFని డౌన్‌లోడ్ చేయండి."
        ],
        bn: [
          "ইউআইডিএআই মাই-আধার পোর্টাল খুলুন।",
          "'ডাউনলোড আধার' এ ক্লিক করে ১২ সংখ্যার নম্বর দিন।",
          "মোবাইলে পাওয়া ওটিপি দিন।",
          "ই-আধার পিডিএফ ডাউনলোড করুন।"
        ]
      },
      offlineSteps: {
        en: [
          "Visit nearest Aadhaar Seva Kendra or post office.",
          "Provide mobile number/enrolment slip for reprint or update.",
          "Collect physical printed Aadhaar letter or PVC Card."
        ],
        hi: [
          "निकटतम आधार सेवा केंद्र या डाकघर में जाएं।",
          "पुनर्मुद्रण के लिए मोबाइल नंबर / नामांकन पर्ची प्रदान करें।",
          "मुद्रित आधार पत्र या पीवीसी कार्ड प्राप्त करें।"
        ],
        ta: [
          "அருகில் உள்ள ஆதார் மையம் அல்லது தபால் நிலையத்திற்குச் செல்லவும்.",
          "அச்சிடப்பட்ட ஆதார் கடிதத்தைப் பெறவும்."
        ],
        te: [
          "సమీప ఆధార్ సేవా కేంద్రం లేదా పోస్టాఫీసును సందర్శించండి.",
          "ఆధార్ లేఖను పొందండి."
        ],
        bn: [
          "নিকটস্থ আধার সেবাকেন্দ্র বা ডাকঘরে যান।",
          "প্রিন্ট করা আধার চিঠি সংগ্রহ করুন।"
        ]
      }
    },
    generic: {
      portalName: "National Document Portal (DigiLocker)",
      portalUrl: "https://digilocker.gov.in",
      displayTitle: {
        en: "Required Document (आवश्यक दस्तावेज)",
        hi: "आवश्यक दस्तावेज (Required Document)",
        ta: "தேவையான ஆவணம் (Required Document)",
        te: "అవసరమైన పత్రం (Required Document)",
        bn: "প্রয়োজনীয় নথি (Required Document)"
      },
      description: {
        en: "An official government certificate or document requested by the automated form.",
        hi: "स्वचालित फॉर्म द्वारा मांगा गया एक आधिकारिक सरकारी प्रमाण पत्र या दस्तावेज।",
        ta: "படிவத்தால் கோரப்பட்ட அதிகாரப்பூர்வ அரசு ஆவணம்.",
        te: "ఫారమ్ కోరిన అధికారిక ప్రభుత్వ పత్రం.",
        bn: "ফর্ম দ্বারা অনুরোধ করা একটি অফিসিয়াল সরকারি নথি।"
      },
      howToIdentify: {
        en: "Official certificate with government emblem, seal, and issuing authority signature.",
        hi: "सरकारी प्रतीक, मुहर और जारीकर्ता प्राधिकारी के हस्ताक्षर वाला आधिकारिक प्रमाण पत्र।",
        ta: "அரசு முத்திரை மற்றும் அதிகாரி கையொப்பம் கொண்ட சான்றிதழ்.",
        te: "ప్రభుత్వ ముద్ర మరియు అధికారి సంతకం ఉన్న సర్టిఫికేట్.",
        bn: "সরকারি সিল ও স্বাক্ষর যুক্ত অফিসিয়াল নথি।"
      },
      onlineSteps: {
        en: [
          "Open DigiLocker portal using official link above.",
          "Search and fetch the required certificate.",
          "Download PDF file."
        ],
        hi: [
          "ऊपर दिए गए लिंक से डिजीलॉकर खोलें।",
          "आवश्यक प्रमाण पत्र खोजें।",
          "पीडीएफ फाइल डाउनलोड करें।"
        ],
        ta: [
          "டிஜிலாக்கர் தளத்தில் PDF ஐப் பதிவிறக்கவும்."
        ],
        te: [
          "డిజిలాకర్ నుండి PDF డౌన్‌లోడ్ చేయండి."
        ],
        bn: [
          "ডিজিটালকার থেকে পিডিএফ ডাউনলোড করুন।"
        ]
      },
      offlineSteps: {
        en: [
          "Visit relevant government office or Jan Seva Kendra.",
          "Collect physical verified copy."
        ],
        hi: [
          "संबंधित सरकारी कार्यालय या जन सेवा केंद्र जाएं।",
          "सत्यापित भौतिक प्रति प्राप्त करें।"
        ],
        ta: [
          "அரசு அலுவலகத்திற்குச் செல்லவும்."
        ],
        te: [
          "ప్రభుత్వ కార్యాలయాన్ని సందర్శించండి."
        ],
        bn: [
          "সরকারি অফিসে যান।"
        ]
      }
    }
  };

  function getDocConfig(docKey) {
    const k = (docKey || "").toLowerCase();
    if (k.includes("income") || k.includes("आय")) return DOCUMENT_DIRECTORY.income_certificate;
    if (k.includes("aadhaar") || k.includes("aadhar") || k.includes("आधार")) return DOCUMENT_DIRECTORY.aadhaar_card;
    return DOCUMENT_DIRECTORY.generic;
  }

  return {
    LANGUAGES,
    STATES_LIST,
    UI_STRINGS,
    DOCUMENT_DIRECTORY,
    getDocConfig
  };
})();
