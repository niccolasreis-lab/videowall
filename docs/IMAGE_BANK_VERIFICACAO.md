# Verificação do banco Musardos

Conferido em 03/11/2026, 10:30 (America/Sao_Paulo).

| Medida | Resultado |
| --- | ---: |
| Nomes distintos consultados | 453 de 453 |
| Consultas com resultados | 433 |
| Consultas sem resultados | 20 |
| Consultas com falha após retentativas | 0 |
| Registros no índice local | 2190 |
| Imagens disponíveis localmente | 2189 |
| Arquivos únicos conferidos por tamanho e SHA-256 | 2011 |
| Bytes armazenados | 1049412907 |
| Erros de integridade | 0 |
| Arquivos rejeitados na origem | 1 |

A varredura dos nomes cadastrados terminou. As consultas que falharam por conexão foram retentadas; a última busca, GOUDA TREM MINAS KG, foi concluída sem o sufixo de unidade, preservando o cadastro original. O ajuste está auditado em data/image-bank/query-adjustment.json.

Dois arquivos com URL .png continham AVIF: estepe-tirolez-kg_2.png e estepe-tirolez-kg_4.png. Foram reconhecidos pela assinatura, preservados como AVIF e exibidos corretamente no navegador, com largura natural de 300 pixels. As nove variantes da busca local por estepe tirolez carregaram corretamente. A seleção de foto real como mídia local foi validada anteriormente com ricota.

A única falha restante é chia farinha granel 1: a URL retorna HTML de Fito Alimentos, com o logotipo do site, sem foto de produto recuperável. O arquivo não foi aceito como imagem; o índice conserva o erro e permite tentar novamente se a origem for corrigida. Não há download em execução.

O estado geral continua incompleto, pois há um arquivo inválido e a listagem total compartilhada permanece sem autorização. Os resultados por pesquisa não comprovam a cobertura de todo o acervo Musardos. Não foi declarada cópia integral do serviço.

Os 55 testes passaram. O SQLite retornou quick_check=ok. Os arquivos salvos passaram na conferência de tamanho e hash. A validação original em JSON está em data/image-bank/verification-8d063d5d-4ea1-4b2b-842f-2afeab24db23.json. Backup final: backups/image-bank-final-2026-11-03.sqlite; inclua também data/image-bank e data/uploads nos backups dos arquivos.
