# StudyAI

> Plataforma de Estudo Inteligente com IA

**Orbis Team** | SESI Maru\u00edpe | Olimp\u00edada Brasileira de Tecnologia (OBT)

---

## Sobre o Projeto

O **StudyAI** \u00e9 uma aplica\u00e7\u00e3o desenvolvida pela equipe **Orbis** do **SESI Maru\u00edpe** para a **Olimp\u00edada Brasileira de Tecnologia (OBT)**.

A plataforma combina intelig\u00eancia artificial personalizada com uma interface de estudo adaptativa, oferecendo conte\u00fado personalizado ao n\u00edvel e ritmo de cada aluno, acompanhamento de progresso e sistema de conquistas.

---

## Arquitetura do Projeto

O projeto \u00e9 composto por quatro pilares principais:

### 1. Microservi\u00e7o de IA (`ia_service.py`)
Um servi\u00e7o Python respons\u00e1vel por orquestrar as requisi\u00e7\u00f5es de intelig\u00eancia artificial.
- **Engine**: Google Gemini 2.5 Flash
- **Fun\u00e7\u00e3o**: Recebe payloads JSON contextuais (n\u00edvel do aluno, hist\u00f3rico, erros) e gera conte\u00fado educacional estruturado (li\u00e7\u00f5es, quizzes, planos de estudo, corre\u00e7\u00f5es).
- **Execu\u00e7\u00e3o**: Via linha de comando, retornando JSON padronizado.

### 2. Backend / API (`api.js` / `hps_server.py`)
O n\u00facleo do servidor que gerencia autentica\u00e7\u00e3o, banco de dados e comunica\u00e7\u00e3o em tempo real.
- **Tecnologias**: Node.js/Express + Python (aiohttp/Socket.IO)
- **Banco de Dados**: SQLite (usu\u00e1rios, conte\u00fado, reputa\u00e7\u00e3o, DNS)
- **Seguran\u00e7a**: Autentica\u00e7\u00e3o via chaves RSA, Proof-of-Work (PoW) para login, sistema de reputa\u00e7\u00e3o e rate limiting.
- **Real-time**: Socket.IO para comunica\u00e7\u00e3o bidirecional com clientes e sincroniza\u00e7\u00e3o de rede.

### 3. Frontend Web (`public/cer.html`)
A interface principal da plataforma de estudos (vers\u00e3o 3.0).
- **Framework**: Vue.js 2
- **Design**: Tema escuro moderno com cards centralizados, responsivo e acess\u00edvel.
- **Funcionalidades**: Dashboard, estudo guiado por IA, f\u00f3rum, certificados, painel do professor e admin.
- **Outras vers\u00f5es**: `new.html` (v2.0) e `old.html` (v1.0 legado).

### 4. Aplicativo Mobile (`StudyAI_updated.aia`)
Aplicativo Android nativo criado no MIT App Inventor.
- **Fun\u00e7\u00e3o**: Wrapper mobile que carrega a plataforma web via `WebViewer`.
- **Design**: Atualizado com o mesmo esquema de cores e identidade visual da interface web (tema escuro, cards, bot\u00f5es arredondados).
- **Importa\u00e7\u00e3o**: Utilize o arquivo `StudyAI_updated.aia` no [MIT App Inventor](https://ai2.appinventor.mit.edu).

---

## Estrutura de Arquivos

| Arquivo | Descri\u00e7\u00e3o |
|---|---|
| `ia_service.py` | Microservi\u00e7o de IA (Python + Gemini) |
| `ia_service-gemini.py` | Vers\u00e3o espec\u00edfica para Gemini |
| `ia_service-huggingface.py` | Vers\u00e3o alternativa para Hugging Face |
| `api.js` | Backend principal (API + Socket.IO) |
| `package.json` | Depend\u00eancias do Node.js |
| `public/cer.html` | Interface web principal (v3.0) |
| `public/new.html` | Interface web anterior (v2.0) |
| `public/old.html` | Interface legado (v1.0) |
| `public/index.html` | P\u00e1gina de sele\u00e7\u00e3o de vers\u00e3o |
| `public/StudyAI_updated.aia` | Projeto MIT App Inventor |

---

## Equipe Orbis

### Humberto Dalmazio Zardini
- Programa\u00e7\u00e3o da interface web e aplica\u00e7\u00e3o Android
- Treinamento do modelo de intelig\u00eancia artificial
- Desenvolvimento do backend e microservi\u00e7os

### Samuel Campos Noia
- Testes de usabilidade e idealiza\u00e7\u00e3o da aplica\u00e7\u00e3o
- Colabora\u00e7\u00e3o para constru\u00e7\u00e3o da aplica\u00e7\u00e3o

### Alyce Rosa dos Santos Pereira
- Idealiza\u00e7\u00e3o da UI/UX
- Idealiza\u00e7\u00e3o do certificado de conclus\u00e3o

### D\u00e9bora Rodrigues de Freitas
- Elabora\u00e7\u00e3o do esbo\u00e7o da UI/UX (desenho)
- Cria\u00e7\u00e3o do certificado de conclus\u00e3o

### Heytor Brum de Freitas
- Bug Bounty da plataforma
- Testes de usabilidade e idealiza\u00e7\u00e3o da aplica\u00e7\u00e3o

---

## Tecnologias Utilizadas

- **Python**: Microservi\u00e7o de IA (`google-genai`)
- **Node.js**: Backend API (`express`, `socket.io`)
- **SQLite**: Banco de dados local
- **Vue.js**: Framework frontend
- **MIT App Inventor**: Aplicativo Android
- **Font Awesome**: \u00cdcones
- **Google Gemini 2.5 Flash**: Modelo de IA

---

## Cores do Tema

O projeto utiliza um esquema de cores moderno (tema escuro):

| Cor | Valor | Uso |
|---|---|---|
| Primary | `#6366F1` | Bot\u00f5es principais, links |
| Primary Dark | `#4F46E5` | Hover, a\u00e7\u00f5es |
| Accent | `#8B5CF6` | Destaques, nomes |
| Background | `#0F172A` | Fundo principal |
| Card | `#334155` | Cards e containers |
| Text Primary | `#F1F5F9` | Texto principal |
| Text Secondary | `#CBD5E1` | Texto secund\u00e1rio |
| Text Muted | `#94A3B8` | Texto discreto |

---

## Como Executar

### Backend
```bash
npm install
npm start
```

### Microservi\u00e7o de IA
```bash
pip install google-genai
export GEMINI_API_KEY="sua-chave-aqui"
python ia_service.py '{"tipo":"geração_de_lições","conteúdo_estudo":"Python"}'
```

### App Mobile
1. Acesse [MIT App Inventor](https://ai2.appinventor.mit.edu)
2. **Projects** \u2192 **Import project (.aia) from my computer**
3. Selecione `StudyAI_updated.aia`

---

> Desenvolvido pela equipe **Orbis** do **SESI Maru\u00edpe** para a **Olimp\u00edada Brasileira de Tecnologia**.
