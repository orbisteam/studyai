# StudyAI

> Plataforma de Estudo Inteligente com IA

**Orbis Team** | SESI Maruípe | Olimpíada Brasileira de Tecnologia (OBT)

---

## Sobre o Projeto

O **StudyAI** é uma aplicação desenvolvida pela equipe **Orbis** do **SESI Maruípe** para a **Olimpíada Brasileira de Tecnologia (OBT)**.

A plataforma combina inteligência artificial personalizada com uma interface de estudo adaptativa, oferecendo conteúdo personalizado ao nível e ritmo de cada aluno, acompanhamento de progresso e sistema de conquistas.

---

## Arquitetura do Projeto

O projeto é composto por quatro pilares principais:

### 1. Microserviço de IA (`ia_service.py`)
Um serviço Python responsável por orquestrar as requisições de inteligência artificial.
- **Engine**: Google Gemini 2.5 Flash
- **Função**: Recebe payloads JSON contextuais (nível do aluno, histórico, erros) e gera conteúdo educacional estruturado (lições, quizzes, planos de estudo, correções).
- **Execução**: Via linha de comando, retornando JSON padronizado.

### 2. Backend / API (`api.js` / `hps_server.py`)
O núcleo do servidor que gerencia autenticação, banco de dados e comunicação em tempo real.
- **Tecnologias**: Node.js/Express + Python (aiohttp/Socket.IO)
- **Banco de Dados**: SQLite (usuários, conteúdo, reputação, DNS)
- **Segurança**: Autenticação via chaves RSA, Proof-of-Work (PoW) para login, sistema de reputação e rate limiting.
- **Real-time**: Socket.IO para comunicação bidirecional com clientes e sincronização de rede.

### 3. Frontend Web (`public/cer.html`)
A interface principal da plataforma de estudos (versão 3.0).
- **Framework**: Vue.js 2
- **Design**: Tema escuro moderno com cards centralizados, responsivo e acessível.
- **Funcionalidades**: Dashboard, estudo guiado por IA, fórum, certificados, painel do professor e admin.
- **Outras versões**: `new.html` (v2.0) e `old.html` (v1.0 legado).

### 4. Aplicativo Mobile (`StudyAI_updated.aia`)
Aplicativo Android nativo criado no MIT App Inventor.
- **Função**: Wrapper mobile que carrega a plataforma web via `WebViewer`.
- **Design**: Atualizado com o mesmo esquema de cores e identidade visual da interface web (tema escuro, cards, botões arredondados).
- **Importação**: Utilize o arquivo `StudyAI_updated.aia` no [MIT App Inventor](https://ai2.appinventor.mit.edu).

---

## Estrutura de Arquivos

| Arquivo | Descrição |
|---|---|
| `ia_service.py` | Microserviço de IA (Python + Gemini) |
| `ia_service-gemini.py` | Versão específica para Gemini |
| `ia_service-huggingface.py` | Versão alternativa para Hugging Face |
| `api.js` | Backend principal (API + Socket.IO) |
| `package.json` | Dependências do Node.js |
| `public/cer.html` | Interface web principal (v3.0) |
| `public/new.html` | Interface web anterior (v2.0) |
| `public/old.html` | Interface legado (v1.0) |
| `public/index.html` | Página de seleção de versão |
| `public/StudyAI_updated.aia` | Projeto MIT App Inventor (atualizado) |
| `public/StudyAI.aia` | Projeto MIT App Inventor (original) |

---

## Equipe Orbis

### Humberto Dalmazio Zardini
- Programação da interface web e aplicação Android
- Treinamento do modelo de inteligência artificial
- Desenvolvimento do backend e microserviços

### Samuel Campos Noia
- Testes de usabilidade e idealização da aplicação
- Colaboração para construção da aplicação

### Alyce Rosa dos Santos Pereira
- Idealização da UI/UX
- Idealização do certificado de conclusão

### Débora Rodrigues de Freitas
- Elaboração do esboço da UI/UX (desenho)
- Criação do certificado de conclusão

### Heytor Brum de Freitas
- Bug Bounty da plataforma
- Testes de usabilidade e idealização da aplicação

---

## Tecnologias Utilizadas

- **Python**: Microserviço de IA (`google-genai`)
- **Node.js**: Backend API (`express`, `socket.io`)
- **SQLite**: Banco de dados local
- **Vue.js**: Framework frontend
- **MIT App Inventor**: Aplicativo Android
- **Font Awesome**: Ícones
- **Google Gemini 2.5 Flash**: Modelo de IA

---

## Cores do Tema

O projeto utiliza um esquema de cores moderno (tema escuro):

| Cor | Valor | Uso |
|---|---|---|
| Primary | `#6366F1` | Botões principais, links |
| Primary Dark | `#4F46E5` | Hover, ações |
| Accent | `#8B5CF6` | Destaques, nomes |
| Background | `#0F172A` | Fundo principal |
| Card | `#334155` | Cards e containers |
| Text Primary | `#F1F5F9` | Texto principal |
| Text Secondary | `#CBD5E1` | Texto secundário |
| Text Muted | `#94A3B8` | Texto discreto |

---

## Como Executar

### Backend
```bash
npm install
npm start
```

### Microserviço de IA
```bash
pip install google-genai
export GEMINI_API_KEY="sua-chave-aqui"
python ia_service.py '{"tipo":"geração_de_lições","conteúdo_estudo":"Python"}'
```

### App Mobile
1. Acesse [MIT App Inventor](https://ai2.appinventor.mit.edu)
2. **Projects** → **Import project (.aia) from my computer**
3. Selecione `StudyAI_updated.aia`

---

> Desenvolvido pela equipe **Orbis** do **SESI Maruípe** para a **Olimpíada Brasileira de Tecnologia**.
