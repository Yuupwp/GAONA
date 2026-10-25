import os,sys,pty,select,time,json,tempfile,pathlib,termios,signal
node,root,scenario=sys.argv[1:]
with tempfile.TemporaryDirectory(prefix='gaona-tty-') as d:
    config=pathlib.Path(d)/'destinatarios.json'
    config.write_text(json.dumps(dict(version=1,habilitado=False,remitente='gaona.proyint1@gmail.com',destinatarios=['ficticio@example.test'])))
    config.chmod(0o600)
    before=config.read_bytes()
    pid,master=pty.fork()
    if pid==0:
        os.chdir(root)
        if scenario=='supervisor-simulado':
            os.execve(node,[node,'tests/fixtures/smtp-supervisor-simulado.cjs',d],dict(PATH='/usr/bin:/bin',HOME=os.environ['HOME'],TERM='xterm-256color'))
        if scenario.startswith('supervisor-'):
            os.execve('/bin/bash',['bash','./api/scripts/entorno-web.sh','brevo'],dict(PATH='/usr/bin:/bin',HOME=os.environ['HOME'],TERM='xterm-256color'))
        os.execve(node,[node,'tests/fixtures/smtp-terminal-lector.cjs','padre',d],dict(PATH='/usr/bin:/bin',HOME=os.environ['HOME'],TERM='xterm-256color'))
    phrase=b'AUTORIZO ENSAYO SMTP LOCAL'
    values=[phrase,b'ficticio@example.test',b'usuario-ficticio',b'ClaveFicticia000']
    if scenario=='pegado':values=[b'\x1b[200~'+v+b'\x1b[201~' for v in values]
    if scenario=='incorrecta':values[0]=b'NO AUTORIZO'
    if scenario=='supervisor-rechazo':values[0]=b'NO AUTORIZO'
    if scenario=='ajeno':values[1]=b'no-autorizado@example.test'
    prompts=[b'para iniciar esta sesi',b'Destinatario autorizado para',b'Usuario SMTP',b'Clave SMTP']
    output=b'';stage=0;echo_hidden=True;start=time.monotonic();expired=False
    while time.monotonic()-start<12:
        if not select.select([master],[],[],.1)[0]:continue
        try:data=os.read(master,8192)
        except OSError:break
        if not data:break
        output+=data
        if stage<len(prompts) and prompts[stage] in output:
            echo_hidden=echo_hidden and not bool(termios.tcgetattr(master)[3]&termios.ECHO)
            if (scenario=='cancelar' and stage==3) or scenario=='supervisor-interrumpir':os.write(master,b'\x03')
            elif scenario=='eof' and stage==3:os.write(master,b'\x04')
            else:os.write(master,values[stage]+b'\n')
            stage+=1
    else:expired=True
    result=os.waitpid(pid,os.WNOHANG)
    if result==(0,0):
        os.killpg(pid,signal.SIGTERM);result=os.waitpid(pid,0)
    restored=bool(termios.tcgetattr(master)[3]&termios.ECHO)
    os.close(master)
    print(json.dumps(dict(exit=os.waitstatus_to_exitcode(result[1]),recibido=b'PTY_RECEPTOR_OK' in output,origen_limpio=b'PTY_ORIGEN_LIMPIO' in output,
        confirmacion_rechazada=b'SMTP_CONFIRMACION' in output,destinatario_rechazado=b'SMTP_DESTINO_NO_AUTORIZADO' in output,
        password_visible=b'ClaveFicticia000' in output,echo_oculto=echo_hidden,echo_restaurado=restored,prompts=stage,timeout=expired,lista_conservada=config.read_bytes()==before,
        simulacion_restaurada=b'entorno restaurado en simulaci' in output)))
