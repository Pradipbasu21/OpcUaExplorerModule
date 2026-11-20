
using Microsoft.Extensions.FileProviders;
using OpcUaWebApi.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// CORS configuration to allow local frontend access
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

// OPC UA client service
builder.Services.AddSingleton<IOpcUaService, OpcUaService>();
builder.Services.AddSingleton<IMqttConnectivityService,
    MqttConnectivityService>();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors();

// Serve the OpcUaExplorer.Web frontend directly from static files
var explorerWebPath = Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, "..", "OpcUaExplorer.Web"));
if (Directory.Exists(explorerWebPath))
{
    app.UseDefaultFiles(new DefaultFilesOptions
    {
        FileProvider = new PhysicalFileProvider(explorerWebPath)
    });
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(explorerWebPath)
    });
}
else
{
    app.UseDefaultFiles();
    app.UseStaticFiles();
}

app.MapControllers();

app.Run();
