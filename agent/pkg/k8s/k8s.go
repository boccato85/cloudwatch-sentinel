package k8s

import (
	"context"
	"fmt"
	"log/slog"
	"path/filepath"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
	"k8s.io/metrics/pkg/apis/metrics/v1beta1"
	metricsv "k8s.io/metrics/pkg/client/clientset/versioned"
	metrics "k8s.io/metrics/pkg/client/clientset/versioned"
)

var (
	Clientset     *kubernetes.Clientset
	MetricsClient metrics.Interface
)

func InitClients() error {
	k8sCfg, err := rest.InClusterConfig()
	if err != nil {
		slog.Info("not running in cluster, trying local kubeconfig", "component", "k8s")
		home := homedir.HomeDir()
		k8sCfg, err = clientcmd.BuildConfigFromFlags("", filepath.Join(home, ".kube", "config"))
		if err != nil {
			return fmt.Errorf("failed to load kubeconfig: %w", err)
		}
	} else {
		slog.Info("using in-cluster Kubernetes config", "component", "k8s")
	}

	Clientset, err = kubernetes.NewForConfig(k8sCfg)
	if err != nil {
		return fmt.Errorf("failed to create k8s client: %w", err)
	}

	MetricsClient, err = metricsv.NewForConfig(k8sCfg)
	if err != nil {
		return fmt.Errorf("failed to create metrics client: %w", err)
	}

	return nil
}

func ListNamespaces(ctx context.Context) (*corev1.NamespaceList, error) {
	return Clientset.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
}

func ListDeployments(ctx context.Context, ns string) (*appsv1.DeploymentList, error) {
	return Clientset.AppsV1().Deployments(ns).List(ctx, metav1.ListOptions{})
}

func ListStatefulSets(ctx context.Context, ns string) (*appsv1.StatefulSetList, error) {
	return Clientset.AppsV1().StatefulSets(ns).List(ctx, metav1.ListOptions{})
}

func ListPods(ctx context.Context, ns string) (*corev1.PodList, error) {
	return Clientset.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{})
}

func ListNodes(ctx context.Context) (*corev1.NodeList, error) {
	return Clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
}

func GetPodLogsRequest(ns, podName string, tailLines int64) *rest.Request {
	return Clientset.CoreV1().Pods(ns).GetLogs(podName, &corev1.PodLogOptions{
		TailLines: &tailLines,
	})
}

// FetchPodMetrics is a variable pointing to the actual metrics retrieval function.
// This allows replacing it with a mock during unit tests.
var FetchPodMetrics = func(ctx context.Context) (*v1beta1.PodMetricsList, error) {
	return MetricsClient.MetricsV1beta1().PodMetricses("").List(ctx, metav1.ListOptions{})
}

func ListPodMetricsWithRetry(ctx context.Context) (*v1beta1.PodMetricsList, error) {
	mList, err := FetchPodMetrics(ctx)
	if err != nil {
		for attempt := 2; attempt <= 3; attempt++ {
			time.Sleep(time.Duration(attempt-1) * time.Second)
			mList, err = FetchPodMetrics(ctx)
			if err == nil {
				break
			}
		}
	}
	return mList, err
}

var PingK8sAPI = func(ctx context.Context) error {
	if Clientset == nil {
		return fmt.Errorf("k8s clientset not initialized")
	}
	_, err := Clientset.Discovery().RESTClient().Get().AbsPath("/readyz").DoRaw(ctx)
	if err != nil {
		_, err = Clientset.Discovery().RESTClient().Get().AbsPath("/livez").DoRaw(ctx)
	}
	return err
}

var PingMetricsAPI = func(ctx context.Context) error {
	if MetricsClient == nil {
		return fmt.Errorf("metrics client not initialized")
	}
	_, err := MetricsClient.Discovery().RESTClient().Get().AbsPath("/apis/metrics.k8s.io/v1beta1").DoRaw(ctx)
	return err
}

var ListEvents = func(ctx context.Context, namespace string) (*corev1.EventList, error) {
	if Clientset == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}
	return Clientset.CoreV1().Events(namespace).List(ctx, metav1.ListOptions{Limit: 200})
}
